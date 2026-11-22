'use strict';

const { existsSync, readFileSync, renameSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { isIP } = require('node:net');
const { performance } = require('node:perf_hooks');
const { verifyXbox } = require('./xbox-auth-probe.cjs');

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

async function observeSession(client, publish, signal, getStage) {
  let startGame = false;
  let spawn = false;
  let chunks = 0;
  let joinedAt;
  let finished = false;
  let timeout;
  let heartbeat;
  await new Promise(resolve => {
    function finish(reason) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      clearInterval(heartbeat);
      signal.removeEventListener('abort', stop);
      client.removeListener('close', closed);
      client.removeListener('start_game', onStartGame);
      client.removeListener('spawn', onSpawn);
      client.removeListener('level_chunk', onChunk);
      // Keep the error handler through close to suppress late SDK errors.
      publish({ phase: reason, stage: getStage() });
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
    client.once('start_game', onStartGame);
    client.once('spawn', onSpawn);
    client.on('level_chunk', onChunk);
    client.once('close', closed);
    client.on('error', () => finish('failed'));
    timeout = setTimeout(() => finish('failed'), 90000);
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
      nethernet: { webrtcBackend: 'werift' },
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
  } catch {
    if (signal.aborted) publish({ phase: 'stopped' });
    else if (stage !== 'auth') publish({ phase: 'failed', stage });
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
    const saveAccount = Number.isInteger(config.saveFd)
      ? account => writeSync(config.saveFd, JSON.stringify(account) + "\n")
      : null;
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
