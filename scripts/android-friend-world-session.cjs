'use strict';

const { existsSync, readFileSync, renameSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { isIP } = require('node:net');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { accountWriter, runtimeLogger, verifyXbox } = require('./android-xbox-auth-probe.cjs');
const { BedrockGameplayBridge } = require('./bedrock-gameplay-bridge.cjs');
const { BedrockMovementController } = require('./bedrock-movement-controller.cjs');
const { BedrockTerrainCache } = require('./bedrock-terrain-cache.cjs');
const { createVanillaRuntimeRegistry } = require('./bedrock-runtime-registry.cjs');
const { planLocalRoute } = require('./bedrock-local-path.cjs');
const { VerifiedAutonomyRunner } = require('./bedrock-autonomy-runner.cjs');
const { BedrockBlockBreakExecutor } = require('./bedrock-block-break.cjs');
const { BedrockLifeSenses } = require('./bedrock-life-senses.cjs');
const { MinePilotIntelligence } = require('./bedrock-intelligence-core.cjs');
const { BedrockGameplayAgent } = require('./bedrock-gameplay-agent.cjs');
const { joinFriendWorld } = require('./android-friend-world-join.cjs');

const ATTEMPT_TIMEOUT_MS = 90_000;
const JOIN_BUDGET_MS = 120_000;
const RETRY_DELAY_MS = 1_000;

async function importRuntimeModule(stagedRelative, builtRelative) {
  const stagedPath = path.resolve(__dirname, stagedRelative);
  const builtPath = path.resolve(__dirname, '..', 'dist', 'src', builtRelative);
  const target = existsSync(stagedPath) ? stagedPath : builtPath;
  if (!existsSync(target)) throw new Error(`Runtime module is not staged or built: ${stagedRelative}`);
  return import(require('node:url').pathToFileURL(target).href);
}

function requireRuntimeModule(stagedRelative, builtRelative) {
  const stagedPath = path.resolve(__dirname, stagedRelative);
  const builtPath = path.resolve(__dirname, '..', 'dist', 'src', builtRelative);
  const target = existsSync(stagedPath) ? stagedPath : builtPath;
  if (!existsSync(target)) throw new Error(`Runtime module is not staged or built: ${stagedRelative}`);
  return require(target);
}

const { BotAwareness } = requireRuntimeModule('bot-awareness.mjs', 'core/bot-awareness.js');

function androidNetworkInterfaces(readInterfaces, readAddresses) {
  return () => {
    try {
      return readInterfaces();
    } catch (error) {
      if (error?.info?.syscall !== 'uv_interface_addresses' ||
          ![1, 13].includes(Math.abs(error.info.errno))) throw error;
      const addresses = readAddresses().flatMap(address => {
        const family = typeof address === 'string' ? isIP(address) : 0;
        return family ? [{ address, family: 'IPv' + family, internal: false }] : [];
      });
      if (addresses.length === 0) throw error;
      return { android: addresses };
    }
  };
}

function validateOwner(ownerXuid, botXuid) {
  if (typeof ownerXuid !== 'string' || !/^[1-9]\d{0,19}$/.test(ownerXuid) ||
      BigInt(ownerXuid) > 18446744073709551615n || ownerXuid === botXuid) {
    throw new Error('Invalid friend owner XUID');
  }
}

function safeJoinFailure(error) {
  const status = error?.status ?? error?.response?.status;
  if (Number.isInteger(status) && status >= 400 && status <= 599) return { httpStatus: status };
  const message = typeof error?.message === 'string' ? error.message : '';
  if (message === 'Xbox world login nonce unavailable') return { reason: 'nonce_unavailable' };
  if (message === 'NetherNet peer closed') {
    const code = error.nethernetCode;
    return Number.isInteger(code) && code > 0 && code <= 255
      ? { reason: 'nethernet_closed', nethernetCode: code }
      : { reason: 'nethernet_closed' };
  }
  if (message === "Couldn't find a Nethernet ID to connect to.") return { reason: 'no_transport' };
  if (/timed out|timeout/i.test(message)) return { reason: 'timeout' };
  const code = error?.cause?.code ?? error?.code;
  if (['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH',
    'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT',
    'ERR_SOCKET_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) return { reason: 'network' };
  if (/signalling|websocket|webrtc|\bice\b/i.test(message)) return { reason: 'transport' };
  return {};
}

function installNonceUserChain(client, nonce) {
  if (typeof nonce !== 'string' || !nonce || typeof client?.createClientUserChain !== 'function') return;
  const jwt = require('jsonwebtoken');
  const original = client.createClientUserChain;
  client.createClientUserChain = function (privateKey) {
    const result = original.call(this, privateKey);
    const payload = jwt.decode(this.clientUserChain);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Bedrock client identity payload is unavailable');
    }
    payload.Nonce = nonce;
    this.clientUserChain = jwt.sign(payload, privateKey, {
      algorithm: 'ES384',
      header: { x5u: this.clientX509, typ: undefined },
      noTimestamp: true
    });
    return result;
  };
}

function installNethernetTelemetry(client, peerId, signallingProtocol) {
  if (!client.nethernet || typeof client.nethernet !== 'object') client.nethernet = {};
  const connection = client.connection;
  if (connection && typeof connection === 'object') {
    const instrumentClose = callback => {
      if (typeof callback !== 'function' || callback.__minepilotCloseWrapped) return callback;
      const wrapped = function (reason, ...args) {
        const value = typeof reason === 'string' ? reason : reason?.message;
        const match = typeof value === 'string' && /connecterror:(\d+)/i.exec(value);
        if (match) {
          client.emit('minepilot_join_failure', {
            reason: 'nethernet_closed', nethernetCode: Number(match[1])
          });
        }
        return callback.call(this, reason, ...args);
      };
      Object.defineProperty(wrapped, '__minepilotCloseWrapped', { value: true });
      return wrapped;
    };
    try {
      let closeCallback = instrumentClose(connection.onCloseConnection);
      Object.defineProperty(connection, 'onCloseConnection', {
        configurable: true,
        enumerable: true,
        get() { return closeCallback; },
        set(value) { closeCallback = instrumentClose(value); }
      });
    } catch {
      try { connection.onCloseConnection = instrumentClose(connection.onCloseConnection); } catch {}
    }
  }
  let signalling = client.nethernet.signalling;
  Object.defineProperty(client.nethernet, 'signalling', {
    configurable: true,
    enumerable: true,
    get() { return signalling; },
    set(value) {
      signalling = value;
      if (!value || typeof value.on !== 'function') return;
      client.emit('minepilot_join_step', 'nethernet_signalling');
      const { SignalType } = require('nethernet');
      if (signallingProtocol === 'jsonrpc' && typeof peerId === 'string' && typeof value.onMessage === 'function') {
        const originalOnMessage = value.onMessage;
        value.onMessage = function (message) {
          let normalized = message;
          try {
            const raw = typeof message === 'string' ? message : message?.toString?.();
            const packet = raw ? JSON.parse(raw) : null;
            const from = packet?.params?.From;
            if (packet?.method === 'Signaling_ReceiveMessage_v1_0' &&
                typeof from === 'string' && from.toLowerCase() === peerId.toLowerCase()) {
              packet.params.From = peerId;
              const encoded = JSON.stringify(packet);
              normalized = typeof message === 'string' ? encoded : Buffer.from(encoded);
            }
          } catch {}
          return originalOnMessage.call(this, normalized);
        };
      }
      if (typeof value.write === 'function') {
        const originalWrite = value.write;
        value.write = function (signal) {
          if (signal?.type === SignalType.ConnectRequest) {
            client.emit('minepilot_join_trace', 'offer_sent');
          }
          return originalWrite.call(this, signal);
        };
      }
      value.once('credentials', () => client.emit('minepilot_join_step', 'nethernet_peer'));
      value.on('signal', signal => {
        if (signal?.type === SignalType.ConnectResponse) {
          client.emit('minepilot_join_trace', 'answer_received');
        }
      });
    }
  });
  if (signalling) client.nethernet.signalling = signalling;
}

function shouldRetry(result) {
  if (result?.phase !== 'failed') return false;
  const transient = ['timeout', 'network'].includes(result.reason) ||
    [408, 425, 429, 500, 502, 503, 504].includes(result.httpStatus);
  if (result.stage === 'xbox_membership') return transient;
  return ['world_transport', 'nethernet_signalling', 'nethernet_peer'].includes(result.stage) &&
    (transient || (result.reason === 'nethernet_closed' && [9, 14].includes(result.nethernetCode)));
}

function bedrockDisconnectCode(reason) {
  // Use the active protocol's enum instead of storing host-controlled display text.
  if (Number.isInteger(reason) && reason >= 0 && reason <= 255) return reason;
  if (typeof reason !== 'string') return;
  const { mappings } = require('minecraft-data')('bedrock_1.26.60').protocol.types.DisconnectFailReason[1];
  const match = Object.entries(mappings).find(([, name]) => name === reason);
  if (match) return Number(match[0]);
}

async function observeSession(client, publish, signal, getStage, timeoutMs = ATTEMPT_TIMEOUT_MS, gameplayOptions = null) {
  const awareness = new BotAwareness();
  // The gameplay bridge observes and commands the SAME authenticated world client.
  // Default remains off for existing join checks and fixture clients.
  const blockBreaker = gameplayOptions ? new BedrockBlockBreakExecutor() : null;
  const terrain = gameplayOptions ? new BedrockTerrainCache() : null;
  const movement = gameplayOptions ? new BedrockMovementController(client, { terrain }) : null;
  const gameplay = gameplayOptions ? new BedrockGameplayBridge(client, {
    commandPath: gameplayOptions.commandPath,
    receiptPath: gameplayOptions.receiptPath,
    manualInputPath: gameplayOptions.manualInputPath,
    movement,
    blockBreaker,
    layerOne: gameplayOptions.layerOneFactory?.() ?? null,
    layerTwo: gameplayOptions.layerTwoFactory?.() ?? null,
    layerThree: gameplayOptions.layerThreeFactory?.() ?? null,
    layerFour: gameplayOptions.layerFourFactory?.() ?? null,
    layerFive: gameplayOptions.layerFiveFactory?.() ?? null,
    layerSix: gameplayOptions.layerSixFactory?.() ?? null,
    layerSeven: gameplayOptions.layerSevenFactory?.() ?? null,
    layerEight: gameplayOptions.layerEightFactory?.() ?? null,
    addonNavigation: gameplayOptions.addonNavigationFactory?.() ?? null,
    terrain,
    registryResolver: createVanillaRuntimeRegistry,
    routePlanner: planLocalRoute,
    autonomy: new VerifiedAutonomyRunner(),
    lifeSenses: new BedrockLifeSenses(),
    intelligence: new MinePilotIntelligence(),
    gameplayAgent: new BedrockGameplayAgent()
  }).start() : null;
  let startGame = false;
  let spawn = false;
  let chunks = 0;
  let joinedAt;
  let finished = false;
  let timeout;
  let heartbeat;
  let connectionStage;
  let disconnectDetails = {};
  const originalClose = client.close;
  if (typeof originalClose === 'function') {
    client.close = function (reason, ...args) {
      const match = typeof reason === 'string' && /^connecterror:(\d+)$/.exec(reason);
      if (match) {
        connectionStage = 'nethernet_peer';
        disconnectDetails = { reason: 'nethernet_closed', nethernetCode: Number(match[1]) };
        publish({ phase: 'connection', stage: connectionStage });
      }
      return originalClose.call(this, reason, ...args);
    };
  }
  const result = await new Promise(resolve => {
    function finish(reason, details = {}) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      clearInterval(heartbeat);
      gameplay?.stop();
      signal.removeEventListener('abort', stop);
      client.removeListener('close', closed);
      client.removeListener('start_game', onStartGame);
      client.removeListener('respawn', onRespawn);
      client.removeListener('update_attributes', onAttributes);
      client.removeListener('spawn', onSpawn);
      client.removeListener('level_chunk', onChunk);
      client.removeListener('minepilot_join_step', onStep);
      client.removeListener('minepilot_join_trace', onTrace);
      client.removeListener('minepilot_join_failure', onFailure);
      client.removeListener('loggingIn', onLogin);
      client.removeListener('join', onJoin);
      client.removeListener('kick', onKick);
      // Keep the error handler through close to suppress late SDK errors.
      try {
        client.close();
      } finally {
        resolve({ phase: reason, stage: connectionStage ?? getStage(), ...details });
      }
    }
    const stop = () => finish('stopped');
    const closed = () => finish(joinedAt === undefined ? 'failed' : 'disconnected', disconnectDetails);
    const report = () => {
      if (joinedAt !== undefined) {
        const vitals = awareness.snapshot();
        publish({ phase: 'spawned', chunks, seconds: Math.floor((performance.now() - joinedAt) / 1000),
          ...(vitals ? { vitals } : {}),
          ...(gameplay ? { gameplay: gameplay.snapshot() } : {}) });
      }
    };
    const checkSpawn = () => {
      if (finished || joinedAt !== undefined || !startGame || !spawn) return;
      clearTimeout(timeout);
      joinedAt = performance.now();
      report();
      heartbeat = setInterval(report, 1000);
    };
    const onStartGame = packet => { awareness.start(packet); startGame = true; checkSpawn(); };
    // The server may assign a new player runtime ID after a death. Re-anchor
    // vitals only when the respawn packet confirms the new spawned player;
    // SearchingForSpawn packets must not clear the current death assessment.
    const onRespawn = packet => {
      const runtimeId = packet?.runtime_entity_id;
      if (packet?.state === 1 && runtimeId != null && String(runtimeId) !== '0')
        awareness.start(packet);
    };
    const onAttributes = packet => awareness.update(packet);
    const onSpawn = () => { spawn = true; checkSpawn(); };
    const onChunk = () => { chunks = Math.min(chunks + 1, Number.MAX_SAFE_INTEGER); };
    const onStep = step => {
      if (['xbox_membership', 'world_transport', 'world_nonce', 'nethernet_signalling', 'nethernet_peer'].includes(step)) {
        connectionStage = step;
        publish({ phase: 'connection', stage: step });
      }
    };
    const onTrace = step => publish({ phase: 'connection', stage: 'nethernet_peer', step });
    const onFailure = details => {
      disconnectDetails = details && typeof details === 'object' ? details : {};
      connectionStage = 'nethernet_peer';
      publish({ phase: 'connection', stage: connectionStage });
    };
    const onLogin = () => {
      connectionStage = 'bedrock_login';
      publish({ phase: 'connection', stage: connectionStage });
    };
    const onJoin = () => {
      connectionStage = 'bedrock_spawn';
      publish({ phase: 'connection', stage: connectionStage });
    };
    const onKick = packet => finish('failed', {
      reason: 'host_disconnect', bedrockCode: bedrockDisconnectCode(packet?.reason)
    });
    client.on('minepilot_join_step', onStep);
    client.on('minepilot_join_trace', onTrace);
    client.on('minepilot_join_failure', onFailure);
    client.once('loggingIn', onLogin);
    client.once('join', onJoin);
    client.once('kick', onKick);
    client.once('start_game', onStartGame);
    client.on('respawn', onRespawn);
    client.on('update_attributes', onAttributes);
    client.once('spawn', onSpawn);
    client.on('level_chunk', onChunk);
    client.once('close', closed);
    client.on('error', error => finish(joinedAt === undefined ? 'failed' : 'disconnected', safeJoinFailure(error)));
    timeout = setTimeout(() => finish('failed', { reason: 'timeout' }), timeoutMs);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  });
  // The pinned SDK exposes pending NetherNet/Xbox cleanup internally after close.
  await client._nethernetCleanup;
  return result;
}

async function run({
  ownerXuid, publish, signal, authDependencies, createClient, pickOwnerWorld,
  saveAccount, gameplayOptions, joinFriendWorldImpl = joinFriendWorld
}) {
  let stage = 'owner';
  let retried = false;
  try {
    if (!ownerXuid || ownerXuid.length > 32) throw new Error();
    stage = 'auth';
    const { auth, profile, xbox } = await verifyXbox(authDependencies, publish, saveAccount);
    signal.throwIfAborted();
    stage = 'owner';
    if (!/^\d+$/.test(ownerXuid)) {
      const friend = await xbox.getProfile({ gamertag: ownerXuid });
      ownerXuid = friend.xuid;
      signal.throwIfAborted();
    }
    validateOwner(ownerXuid, profile.xuid);
    const deadline = performance.now() + JOIN_BUDGET_MS;
    async function attempt(timeoutMs) {
      signal.throwIfAborted();
      stage = 'discovery';
      publish({ phase: 'discovery', gamertag: profile.gamertag, ...(retried ? { retried } : {}) });
      let prepared;
      try {
        prepared = await joinFriendWorldImpl({
          xbox, profile, ownerXuid,
          XboxRTASocket: authDependencies.XboxRTASocket,
          pickOwnerWorld, publish, signal,
          onStage(next) { stage = next; }
        });
      } catch (error) {
        return { phase: 'failed', stage, ...safeJoinFailure(error) };
      }

      let client;
      try {
        client = createClient({
          username: profile.gamertag,
          offline: false,
          version: '1.26.60',
          authTitle: authDependencies.Titles.MinecraftAndroid,
          deviceType: 'Android',
          authflow: auth,
          transport: 'nethernet',
          skipPing: true,
          connectTimeout: 45000,
          nethernet: {
            networkId: prepared.peerId,
            webrtcBackend: 'werift',
            signalling: 'services',
            _signallingProtocol: prepared.signallingProtocol,
            responseTimeoutMs: 25000,
            inactivityTimeoutMs: 12000
          },
          conLog: null
        });
        client.nethernet ??= {};
        client.nethernet.sessionAbort = prepared.sessionAbort;
        client.nethernet.session = prepared.session;
        installNonceUserChain(client, prepared.nonce);
        installNethernetTelemetry(client, prepared.peerId, prepared.signallingProtocol);
        client.viewDistance = 4;
      } catch (error) {
        await prepared.session.close().catch(() => {});
        return { phase: 'failed', stage, ...safeJoinFailure(error) };
      }
      return observeSession(client, publish, signal, () => stage, timeoutMs, gameplayOptions);
    }
    let result = await attempt(ATTEMPT_TIMEOUT_MS);
    signal.throwIfAborted();
    if (shouldRetry(result) && deadline - performance.now() > RETRY_DELAY_MS) {
      publish({ phase: 'retrying' });
      await delay(RETRY_DELAY_MS, undefined, { signal });
      const remaining = Math.floor(deadline - performance.now());
      if (remaining > 0) {
        retried = true;
        result = await attempt(remaining);
        signal.throwIfAborted();
      }
    }
    publish({ ...result, ...(retried ? { retried } : {}) });
  } catch (error) {
    if (signal.aborted) publish({ phase: 'stopped' });
    else if (stage !== 'auth') publish({ phase: 'failed', stage, ...safeJoinFailure(error), ...(retried ? { retried } : {}) });
  }
}

if (require.main === module) {
  process.env.HOME ??= __dirname;
  require('debug').disable();
  console.info = console.warn = console.error = console.log = () => {};
  const file = path.join(__dirname, 'auth-status.json');
  let record = () => {};
  const publish = snapshot => {
    writeFileSync(file + '.tmp', JSON.stringify(snapshot), { mode: 0o600 });
    renameSync(file + '.tmp', file);
    record(snapshot);
  };
  const controller = new AbortController();
  const stop = setInterval(() => {
    if (existsSync(path.join(__dirname, 'stop-session'))) controller.abort();
  }, 250);
  (async () => {
    const configPath = path.join(__dirname, 'device-session.json');
    const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
    record = runtimeLogger(config.logFile);
    const addressFile = path.join(__dirname, 'network-addresses.json');
    if (existsSync(addressFile)) {
      // Werift uses Node's interface enumeration when gathering ICE candidates.
      // The isolated Android process supplies its documented default-network addresses on permission errors.
      os.networkInterfaces = androidNetworkInterfaces(os.networkInterfaces,
        () => JSON.parse(readFileSync(addressFile, 'utf8')));
    }
    const { Authflow, Titles } = require('prismarine-auth');
    const { XboxClient, XboxRTASocket } = require('prismarine-xbox-services');
    const { createClient } = require('bedrock-protocol');
    const { pickOwnerWorld } = await importRuntimeModule('prismarine-world-client.mjs', 'connection/prismarine-world-client.js');
    const { LayerOneController } = await importRuntimeModule('gameplay/layer-one.js', 'gameplay/layer-one.js');
    const { LayerTwoPlanner } = await importRuntimeModule('gameplay/layer-two.js', 'gameplay/layer-two.js');
    const { LayerThreePlanner } = await importRuntimeModule('gameplay/layer-three.js', 'gameplay/layer-three.js');
    const { LayerFourSupervisor } = await importRuntimeModule('gameplay/layer-four.js', 'gameplay/layer-four.js');
    const { LayerFivePlanner } = await importRuntimeModule('gameplay/layer-five.js', 'gameplay/layer-five.js');
    const { LayerSixWorkflow } = await importRuntimeModule('gameplay/layer-six.js', 'gameplay/layer-six.js');
    const { LayerSevenAdvisor } = await importRuntimeModule('gameplay/layer-seven.js', 'gameplay/layer-seven.js');
    const { LayerEightReadiness } = await importRuntimeModule('gameplay/layer-eight.js', 'gameplay/layer-eight.js');
    const { BedrockMotionArbiter } = await importRuntimeModule('gameplay/addon-navigation.js', 'gameplay/addon-navigation.js');
    const refreshToken = Number.isInteger(config.fd) ? readFileSync(config.fd, 'utf8') : undefined;
    const saveAccount = accountWriter(config.saveFd);
    await run({
      ownerXuid: readFileSync(path.join(__dirname, 'owner-xuid'), 'utf8'),
      publish,
      signal: controller.signal,
      authDependencies: { Authflow, Titles, XboxClient, XboxRTASocket, refreshToken },
      saveAccount,
      createClient,
      pickOwnerWorld,
      gameplayOptions: {
        commandPath: path.join(__dirname, 'gameplay-command.json'),
        receiptPath: path.join(__dirname, 'gameplay-receipt.json'),
        manualInputPath: path.join(__dirname, 'manual-input-state.json'),
        layerOneFactory: () => new LayerOneController(),
        layerTwoFactory: () => new LayerTwoPlanner(),
        layerThreeFactory: () => new LayerThreePlanner(),
        layerFourFactory: () => new LayerFourSupervisor(),
        layerFiveFactory: () => new LayerFivePlanner(),
        layerSixFactory: () => new LayerSixWorkflow(),
        layerSevenFactory: () => new LayerSevenAdvisor(),
        layerEightFactory: () => new LayerEightReadiness(),
        addonNavigationFactory: () => new BedrockMotionArbiter()
      }
    });
  })().catch(() => publish({ phase: 'failed', stage: 'runtime' }))
    .finally(() => clearInterval(stop));
}

module.exports = { androidNetworkInterfaces, installNethernetTelemetry, installNonceUserChain, observeSession, run, shouldRetry, validateOwner };
