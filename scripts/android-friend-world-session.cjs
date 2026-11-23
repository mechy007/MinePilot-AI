'use strict';

const { existsSync, readFileSync, renameSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { isIP } = require('node:net');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { accountWriter, runtimeLogger, verifyXbox } = require('./xbox-auth-probe.cjs');
const { BotAwareness } = require('./bot-awareness.mjs');
const { BedrockGameplayBridge } = require('./bedrock-gameplay-bridge.cjs');
const { ExperimentalPlayerInput } = require('./bedrock-player-input.cjs');
const { BedrockTerrainCache } = require('./bedrock-terrain-cache.cjs');
const { createVanillaRuntimeRegistry } = require('./bedrock-runtime-registry.cjs');
const { planLocalRoute } = require('./bedrock-local-path.cjs');
const { VerifiedAutonomyRunner } = require('./bedrock-autonomy-runner.cjs');

const ATTEMPT_TIMEOUT_MS = 90_000;
const JOIN_BUDGET_MS = 120_000;
const RETRY_DELAY_MS = 1_000;

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
    'ECONNRESET', 'ECONNREFUSED'].includes(code)) return { reason: 'network' };
  if (/signalling|websocket|webrtc|\bice\b/i.test(message)) return { reason: 'transport' };
  return {};
}

function shouldRetry(result) {
  return result.phase === 'failed' &&
    ['nethernet_signalling', 'nethernet_peer'].includes(result.stage) &&
    (['timeout', 'network'].includes(result.reason) ||
      (result.reason === 'nethernet_closed' && [9, 14].includes(result.nethernetCode)));
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
  const gameplay = gameplayOptions ? new BedrockGameplayBridge(client, {
    commandPath: gameplayOptions.commandPath,
    receiptPath: gameplayOptions.receiptPath,
    movement: new ExperimentalPlayerInput(client, gameplayOptions.experimentalMovement === true, {
      // Standing-still 20Hz input is standard Bedrock player presence, not
      // opt-in walking. Same writer/packet tick stream as user diagnostics.
      presenceEnabled: true
    }),
    layerOne: gameplayOptions.layerOneFactory?.() ?? null,
    layerTwo: gameplayOptions.layerTwoFactory?.() ?? null,
    layerThree: gameplayOptions.layerThreeFactory?.() ?? null,
    layerFour: gameplayOptions.layerFourFactory?.() ?? null,
    layerFive: gameplayOptions.layerFiveFactory?.() ?? null,
    layerSix: gameplayOptions.layerSixFactory?.() ?? null,
    layerSeven: gameplayOptions.layerSevenFactory?.() ?? null,
    layerEight: gameplayOptions.layerEightFactory?.() ?? null,
    addonNavigation: gameplayOptions.addonNavigationFactory?.() ?? null,
    terrain: new BedrockTerrainCache(),
    registryResolver: createVanillaRuntimeRegistry,
    routePlanner: planLocalRoute,
    autonomy: new VerifiedAutonomyRunner()
  }).start() : null;
  let startGame = false;
  let spawn = false;
  let chunks = 0;
  let joinedAt;
  let finished = false;
  let timeout;
  let heartbeat;
  let connectionStage;
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
      client.removeListener('update_attributes', onAttributes);
      client.removeListener('spawn', onSpawn);
      client.removeListener('level_chunk', onChunk);
      client.removeListener('minepilot_join_step', onStep);
      client.removeListener('minepilot_join_trace', onTrace);
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
    const closed = () => finish(joinedAt === undefined ? 'failed' : 'disconnected');
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
    client.once('loggingIn', onLogin);
    client.once('join', onJoin);
    client.once('kick', onKick);
    client.once('start_game', onStartGame);
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

async function run({ ownerXuid, publish, signal, authDependencies, createClient, pickOwnerWorld, saveAccount, gameplayOptions }) {
  let stage = 'owner';
  let retried = false;
  try {
    if (!ownerXuid || ownerXuid.length > 32) throw new Error();
    stage = 'auth';
    const { auth, profile } = await verifyXbox(authDependencies, publish, saveAccount);
    signal.throwIfAborted();
    stage = 'owner';
    if (!/^\d+$/.test(ownerXuid)) {
      const xbox = new authDependencies.XboxClient(auth);
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
      const client = createClient({
        username: profile.gamertag,
        offline: false,
        version: '1.26.60',
        authTitle: authDependencies.Titles.MinecraftAndroid,
        deviceType: 'Android',
        authflow: auth,
        // Give the mobile path room for signalling and ICE before the spawn deadline.
        connectTimeout: 45000,
        nethernet: { webrtcBackend: 'werift', responseTimeoutMs: 25000, inactivityTimeoutMs: 12000 },
        conLog: null,
        world: {
          pickSession(sessions) {
            const selected = pickOwnerWorld(sessions, ownerXuid);
            stage = 'connection';
            publish({ phase: 'connection' });
            return selected;
          }
        }
      });
      client.viewDistance = 4;
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
    const { XboxClient } = require('prismarine-xbox-services');
    const { createClient } = require('bedrock-protocol');
    const { pickOwnerWorld } = await import('./prismarine-world-client.mjs');
    const { LayerOneController } = await import('./gameplay/layer-one.js');
    const { LayerTwoPlanner } = await import('./gameplay/layer-two.js');
    const { LayerThreePlanner } = await import('./gameplay/layer-three.js');
    const { LayerFourSupervisor } = await import('./gameplay/layer-four.js');
    const { LayerFivePlanner } = await import('./gameplay/layer-five.js');
    const { LayerSixWorkflow } = await import('./gameplay/layer-six.js');
    const { LayerSevenAdvisor } = await import('./gameplay/layer-seven.js');
    const { LayerEightReadiness } = await import('./gameplay/layer-eight.js');
    const { BedrockMotionArbiter } = await import('./gameplay/addon-navigation.js');
    const refreshToken = Number.isInteger(config.fd) ? readFileSync(config.fd, 'utf8') : undefined;
    const saveAccount = accountWriter(config.saveFd);
    await run({
      ownerXuid: readFileSync(path.join(__dirname, 'owner-xuid'), 'utf8'),
      publish,
      signal: controller.signal,
      authDependencies: { Authflow, Titles, XboxClient, refreshToken },
      saveAccount,
      createClient,
      pickOwnerWorld,
      gameplayOptions: {
        commandPath: path.join(__dirname, 'gameplay-command.json'),
        receiptPath: path.join(__dirname, 'gameplay-receipt.json'),
        experimentalMovement: config.experimentalMovement === true,
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

module.exports = { androidNetworkInterfaces, observeSession, run, validateOwner };
