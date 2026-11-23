'use strict';

const { existsSync, readFileSync, renameSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { isIP } = require('node:net');
const { performance } = require('node:perf_hooks');
const { accountWriter, verifyXbox } = require('./xbox-auth-probe.cjs');

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
  if (message === 'NetherNet peer closed') {
    const code = error.nethernetCode;
    return Number.isInteger(code) && code > 0 && code <= 255
      ? { reason: 'nethernet_closed', nethernetCode: code }
      : { reason: 'nethernet_closed' };
  }
  if (message === "Couldn't find a Nethernet ID to connect to.") return { reason: 'no_transport' };
  if (/timed out|timeout/i.test(message)) return { reason: 'timeout' };
  if (/signalling|websocket|webrtc|\bice\b/i.test(message)) return { reason: 'transport' };
  const code = error?.cause?.code ?? error?.code;
  if (['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH',
    'ECONNRESET', 'ECONNREFUSED'].includes(code)) return { reason: 'network' };
  return {};
}

async function observeSession(client, publish, signal, getStage) {
  let startGame = false;
  let spawn = false;
  let chunks = 0;
  let joinedAt;
  let finished = false;
  let timeout;
  let heartbeat;
  let connectionStage;
  await new Promise(resolve => {
    function finish(reason, details = {}) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      clearInterval(heartbeat);
      signal.removeEventListener('abort', stop);
      client.removeListener('close', closed);
      client.removeListener('start_game', onStartGame);
      client.removeListener('spawn', onSpawn);
      client.removeListener('level_chunk', onChunk);
      client.removeListener('minepilot_join_step', onStep);
      client.removeListener('loggingIn', onLogin);
      client.removeListener('join', onJoin);
      client.removeListener('kick', onKick);
      // Keep the error handler through close to suppress late SDK errors.
      publish({ phase: reason, stage: connectionStage ?? getStage(), ...details });
      try {
        client.close();
      } finally {
        resolve();
      }
    }
    const stop = () => finish('stopped');
    const closed = () => finish(joinedAt === undefined ? 'failed' : 'disconnected');
    const report = () => {
      if (joinedAt !== undefined) {
        publish({ phase: 'spawned', chunks, seconds: Math.floor((performance.now() - joinedAt) / 1000) });
      }
    };
    const checkSpawn = () => {
      if (finished || !startGame || !spawn) return;
      clearTimeout(timeout);
      joinedAt = performance.now();
      report();
      heartbeat = setInterval(report, 1000);
    };
    const onStartGame = () => { startGame = true; checkSpawn(); };
    const onSpawn = () => { spawn = true; checkSpawn(); };
    const onChunk = () => { chunks = Math.min(chunks + 1, Number.MAX_SAFE_INTEGER); };
    const onStep = step => {
      if (['xbox_membership', 'world_transport', 'nethernet_signalling', 'nethernet_peer'].includes(step)) {
        connectionStage = step;
        publish({ phase: 'connection', stage: step });
      }
    };
    const onLogin = () => { connectionStage = 'bedrock_login'; };
    const onJoin = () => { connectionStage = 'bedrock_spawn'; };
    const onKick = () => finish('failed', { reason: 'host_disconnect' });
    client.on('minepilot_join_step', onStep);
    client.once('loggingIn', onLogin);
    client.once('join', onJoin);
    client.once('kick', onKick);
    client.once('start_game', onStartGame);
    client.once('spawn', onSpawn);
    client.on('level_chunk', onChunk);
    client.once('close', closed);
    client.on('error', error => finish('failed', safeJoinFailure(error)));
    timeout = setTimeout(() => finish('failed', { reason: 'timeout' }), 90000);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  });
  // The pinned SDK exposes pending NetherNet/Xbox cleanup internally after close.
  await client._nethernetCleanup;
}

async function run({ ownerXuid, publish, signal, authDependencies, createClient, pickOwnerWorld, saveAccount }) {
  let stage = 'owner';
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
    stage = 'discovery';
    publish({ phase: 'discovery', gamertag: profile.gamertag });
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
    await observeSession(client, publish, signal, () => stage);
  } catch (error) {
    if (signal.aborted) publish({ phase: 'stopped' });
    else if (stage !== 'auth') publish({ phase: 'failed', stage, ...safeJoinFailure(error) });
  }
}

if (require.main === module) {
  process.env.HOME ??= __dirname;
  require('debug').disable();
  console.info = console.warn = console.error = console.log = () => {};
  const file = path.join(__dirname, 'auth-status.json');
  const publish = snapshot => {
    writeFileSync(file + '.tmp', JSON.stringify(snapshot), { mode: 0o600 });
    renameSync(file + '.tmp', file);
  };
  const controller = new AbortController();
  const stop = setInterval(() => {
    if (existsSync(path.join(__dirname, 'stop-session'))) controller.abort();
  }, 250);
  (async () => {
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
    const configPath = path.join(__dirname, 'device-session.json');
    const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
    const refreshToken = Number.isInteger(config.fd) ? readFileSync(config.fd, 'utf8') : undefined;
    const saveAccount = accountWriter(config.saveFd);
    await run({
      ownerXuid: readFileSync(path.join(__dirname, 'owner-xuid'), 'utf8'),
      publish,
      signal: controller.signal,
      authDependencies: { Authflow, Titles, XboxClient, refreshToken },
      saveAccount,
      createClient,
      pickOwnerWorld
    });
  })().catch(() => publish({ phase: 'failed', stage: 'runtime' }))
    .finally(() => clearInterval(stop));
}

module.exports = { androidNetworkInterfaces, observeSession, run, validateOwner };
