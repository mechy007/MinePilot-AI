'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { androidNetworkInterfaces, observeSession, run, shouldRetry, validateOwner } = require('./android-friend-world-session.cjs');
const { runtimeLogger } = require('./android-xbox-auth-probe.cjs');

const { existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
function runtimeModulePath(stagedRelative, builtRelative) {
  const staged = [join(__dirname, stagedRelative), join(__dirname, '..', stagedRelative)]
    .find(existsSync);
  const built = resolve(__dirname, '..', 'dist', 'src', builtRelative);
  const target = staged ?? built;
  if (!existsSync(target)) throw new Error(`Runtime module is not staged or built: ${stagedRelative}`);
  return target;
}
function requireRuntimeModule(stagedRelative, builtRelative) {
  return require(runtimeModulePath(stagedRelative, builtRelative));
}
async function importRuntimeModule(stagedRelative, builtRelative) {
  return import(require('node:url').pathToFileURL(runtimeModulePath(stagedRelative, builtRelative)).href);
}

class Client extends EventEmitter {
  closed = 0;
  sent = [];
  queue(packet, value) { this.sent.push({ packet, value }); }
  close(reason) {
    if (this.closed) return;
    this.closed++;
    const cleanup = this.nethernet?.session?.close?.();
    if (cleanup !== undefined) this._nethernetCleanup = Promise.resolve(cleanup);
    else this._nethernetCleanup ??= Promise.resolve();
    this.emit('close', reason);
  }
}

test('runtime logs retain diagnostic codes and omit private data and duplicate heartbeats', context => {
  const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
  const { join } = require('node:path');
  const directory = mkdtempSync(join(require('node:os').tmpdir(), 'minepilot-log-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'events.jsonl');
  const log = runtimeLogger(file);
  log({ phase: 'device_code', userCode: 'private', verificationUri: 'private' });
  log({ phase: 'spawned', seconds: 1 });
  log({ phase: 'spawned', seconds: 2 });
  log({ phase: 'private', stage: 'private' });
  log({ phase: 'failed', stage: 'nethernet_peer', reason: 'nethernet_closed',
    nethernetCode: 37, gamertag: 'private', xuid: 'private', rawError: 'private' });
  log({ phase: 'failed', stage: 'bedrock_login', reason: 'host_disconnect', bedrockCode: 136,
    nonce: 'private', message: 'private' });
  const events = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(events.every(event => Number.isInteger(event.at)));
  assert.deepEqual(events.map(({ at, ...event }) => event), [
    { phase: 'device_code' }, { phase: 'spawned' },
    { phase: 'failed', stage: 'nethernet_peer', reason: 'nethernet_closed', nethernetCode: 37 },
    { phase: 'failed', stage: 'bedrock_login', reason: 'host_disconnect', bedrockCode: 136 }
  ]);
});

test('retries transient Xbox membership timeouts but not permanent membership failures', () => {
  assert.equal(shouldRetry({ phase: 'failed', stage: 'xbox_membership', reason: 'timeout' }), true);
  assert.equal(shouldRetry({ phase: 'failed', stage: 'xbox_membership', reason: 'network' }), true);
  for (const httpStatus of [408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(shouldRetry({ phase: 'failed', stage: 'xbox_membership', httpStatus }), true);
  }
  for (const httpStatus of [400, 401, 403, 404]) {
    assert.equal(shouldRetry({ phase: 'failed', stage: 'xbox_membership', httpStatus }), false);
  }
  assert.equal(shouldRetry({ phase: 'failed', stage: 'bedrock_login', reason: 'timeout' }), false);
  assert.equal(shouldRetry({ phase: 'disconnected', stage: 'xbox_membership', reason: 'timeout' }), false);
});

test('validates the exact owner Xbox ID without converting it to a number', () => {
  assert.doesNotThrow(() => validateOwner('18446744073709551615'));
  for (const value of ['0', '01', '18446744073709551616', 'abc', '42']) {
    assert.throws(() => validateOwner(value, '42'));
  }
});

test('requires start game and spawn and waits for SDK cleanup when stopped', async () => {
  const client = new Client();
  const controller = new AbortController();
  const snapshots = [];
  let completeCleanup;
  client._nethernetCleanup = new Promise(resolve => { completeCleanup = resolve; });
  const session = observeSession(client, state => snapshots.push(state), controller.signal, () => 'connection');
  client.emit('spawn');
  client.emit('level_chunk', { secret: 'world fixture' });
  assert.deepEqual(snapshots, []);
  client.emit('start_game');
  assert.deepEqual(snapshots, [{ phase: 'spawned', chunks: 1, seconds: 0 }]);
  controller.abort();
  client.emit('error', new Error('Late SDK error'));
  assert.equal(client.closed, 1);
  assert.equal(snapshots.at(-1).phase, 'spawned');
  completeCleanup();
  assert.deepEqual(await session, { phase: 'stopped', stage: 'connection' });
});

test('ignores late spawn events while an aborted client closes', async () => {
  const client = new Client();
  client.close = () => {
    client.emit('start_game');
    client.emit('spawn');
    client.emit('level_chunk', {});
    client.emit('error', new Error('Late SDK error'));
  };
  const controller = new AbortController();
  const snapshots = [];
  const session = observeSession(client, state => snapshots.push(state), controller.signal, () => 'connection');
  controller.abort();
  assert.deepEqual(await session, { phase: 'stopped', stage: 'connection' });
  assert.deepEqual(snapshots, []);
  assert.equal(client.listenerCount('level_chunk'), 0);
});

test('reports a safe failure on a disconnect before the world starts', async () => {
  const client = new Client();
  const snapshots = [];
  const session = observeSession(client, state => snapshots.push(state), new AbortController().signal, () => 'connection');
  client.emit('close');
  assert.deepEqual(await session, { phase: 'failed', stage: 'connection' });
  assert.deepEqual(snapshots, []);
});

test('assesses the bot’s own vitals from the live session without issuing actions', async () => {
  const client = new Client();
  const snapshots = [];
  const controller = new AbortController();
  const session = observeSession(client, snapshot => snapshots.push(snapshot), controller.signal, () => 'connection');
  const update = (runtime_entity_id, health, hunger) => client.emit('update_attributes', {
    runtime_entity_id,
    attributes: [
      { name: 'minecraft:health', current: health },
      { name: 'minecraft:player.hunger', current: hunger }
    ]
  });
  client.emit('start_game', { runtime_entity_id: 18446744073709551610n });
  update('18446744073709551610', 5, 4);
  update('18446744073709551611', 20, 20);
  client.emit('spawn');
  assert.deepEqual(snapshots.at(-1)?.vitals, { health: 5, hunger: 4, assessment: 'recover_health' });
  controller.abort();
  await session;
  assert.equal(client.listenerCount('update_attributes'), 0);
});


test('reanchors vitals to the new player runtime ID after server respawn', async () => {
  const client = new Client();
  const snapshots = [];
  const controller = new AbortController();
  const session = observeSession(client, snapshot => snapshots.push(snapshot),
    controller.signal, () => 'connection');
  const update = (runtime_entity_id, health, hunger) => client.emit('update_attributes', {
    runtime_entity_id,
    attributes: [
      { name: 'minecraft:health', current: health },
      { name: 'minecraft:player.hunger', current: hunger }
    ]
  });

  client.emit('start_game', { runtime_entity_id: 41n });
  update('41', 0, 0);
  client.emit('spawn');
  assert.equal(snapshots.at(-1)?.vitals?.assessment, 'dead');

  // SearchingForSpawn does not clear the dead state.
  client.emit('respawn', { state: 0, runtime_entity_id: 41n });
  assert.equal(snapshots.at(-1)?.vitals?.assessment, 'dead');

  // The server confirms the new player identity. Old-ID updates are ignored.
  client.emit('respawn', { state: 1, runtime_entity_id: 42n,
    position: { x: 0, y: 64, z: 0 } });
  update('41', 0, 0);
  update('42', 20, 20);
  await new Promise(resolve => setTimeout(resolve, 1050));

  assert.deepEqual(snapshots.at(-1)?.vitals, {
    health: 20, hunger: 20, assessment: 'ready'
  });
  controller.abort();
  await session;
  assert.equal(client.listenerCount('respawn'), 0);
});

test('awareness distinguishes food needs, recovery and incomplete data', () => {
  const { BotAwareness } = requireRuntimeModule('bot-awareness.mjs', 'core/bot-awareness.js');
  const awareness = new BotAwareness();
  const update = (...attributes) => awareness.update({
    runtime_entity_id: 1n,
    attributes: attributes.map(([name, current]) => ({ name, current }))
  });
  awareness.start({ runtime_entity_id: 1n });
  assert.equal(awareness.snapshot(), undefined);
  update(['minecraft:health', 20]);
  assert.equal(awareness.snapshot().assessment, 'awaiting_vitals');
  update(['minecraft:player.hunger', 5]);
  assert.equal(awareness.snapshot().assessment, 'needs_food');
  update(['minecraft:player.hunger', 20], ['minecraft:health', NaN]);
  assert.equal(awareness.snapshot().assessment, 'ready');
  update(['minecraft:health', 0]);
  assert.equal(awareness.snapshot().assessment, 'dead');
});

test('captures the Bedrock disconnect code without forwarding the server message', async () => {
  const client = new Client();
  const session = observeSession(client, () => {}, new AbortController().signal, () => 'connection');
  client.emit('loggingIn');
  client.emit('kick', { reason: 'nonce_missing', message: 'private server text' });
  assert.deepEqual(await session, {
    phase: 'failed', stage: 'bedrock_login', reason: 'host_disconnect', bedrockCode: 136
  });
});

test('hands the verified account to the friend-world runtime with exact owner selection', async () => {
  const { pickOwnerWorld } = await importRuntimeModule('prismarine-world-client.mjs', 'connection/prismarine-world-client.js');
  const snapshots = [];
  const client = new Client();
  let auth;
  class Authflow {
    constructor() { auth = this; }
    async getXboxToken() {}
    async getMinecraftBedrockToken() {
      const payload = Buffer.from(JSON.stringify({ extraData: { XUID: '42' } })).toString('base64url');
      return { chain: ['fixture', 'header.' + payload + '.signature'], token: 'fixture' };
    }
  }
  class XboxClient {
    async getProfile(identifier) {
      if (identifier === 'me') return { xuid: '42', gamertag: 'Bot' };
      assert.deepEqual(identifier, { gamertag: 'Friend' });
      return { xuid: '84', gamertag: 'Friend' };
    }
  }
  await run({
    ownerXuid: 'Friend',
    publish: snapshot => snapshots.push(snapshot),
    signal: new AbortController().signal,
    authDependencies: { Authflow, XboxClient, Titles: { MinecraftAndroid: 'android' } },
    pickOwnerWorld,
    joinFriendWorldImpl: async ({ ownerXuid, pickOwnerWorld: select, publish, onStage }) => {
      assert.equal(ownerXuid, '84');
      const handle = { id: 'handle-84', sessionRef: { name: 'target' },
        customProperties: { ownerId: '84', protocol: 2225 } };
      assert.equal(select([
        { id: 'wrong', sessionRef: { name: 'other' }, ownerXuid: '84', customProperties: { ownerId: '55' } },
        handle
      ], ownerXuid), handle);
      onStage('world_nonce');
      publish({ phase: 'connection', stage: 'world_nonce' });
      return {
        networkId: '123',
        peerId: '123',
        signallingProtocol: 'legacy',
        nonce: null,
        sessionAbort: new AbortController(),
        session: { async close() {} }
      };
    },
    createClient(options) {
      assert.equal(options.authflow, auth);
      assert.equal(options.authTitle, 'android');
      assert.equal(options.offline, false);
      assert.equal(options.transport, 'nethernet');
      assert.equal(options.nethernet.networkId, '123');
      assert.equal(options.nethernet._peerPlayerId, undefined);
      client.nethernet = {};
      queueMicrotask(() => {
        client.emit('start_game');
        client.emit('spawn');
        client.close();
      });
      return client;
    }
  });
  assert.deepEqual(snapshots.map(snapshot => snapshot.phase), [
    'bedrock_credentials', 'verified', 'discovery', 'connection', 'spawned', 'disconnected'
  ]);
});

for (const cancel of [false, true]) {
  test(cancel ? 'cancel stops a pending retry' : 'a peer timeout gets exactly one fresh join after cleanup', async () => {
    const { pickOwnerWorld } = await importRuntimeModule('prismarine-world-client.mjs', 'connection/prismarine-world-client.js');
    const controller = new AbortController();
    const snapshots = [];
    const clients = [];
    const selected = [];
    let finishCleanup;
    let verified = 0;
    const membershipCleaned = new Promise(resolve => { finishCleanup = resolve; });
    class Authflow {
      async getXboxToken() { verified++; }
      async getMinecraftBedrockToken() {
        const payload = Buffer.from(JSON.stringify({ extraData: { XUID: '42' } })).toString('base64url');
        return { chain: ['fixture', 'header.' + payload + '.signature'], token: 'fixture' };
      }
    }
    class XboxClient {
      async getProfile() { return { xuid: '42', gamertag: 'Bot' }; }
    }
    let joinAttempts = 0;
    const session = run({
      ownerXuid: '84',
      signal: controller.signal,
      publish(snapshot) {
        snapshots.push(snapshot);
        if (cancel && snapshot.phase === 'retrying') controller.abort();
      },
      authDependencies: { Authflow, XboxClient, Titles: { MinecraftAndroid: 'android' } },
      pickOwnerWorld,
      joinFriendWorldImpl: async ({ onStage, publish }) => {
        joinAttempts++;
        selected.push(joinAttempts === 1 ? 'first' : 'fresh');
        onStage('world_nonce');
        publish({ phase: 'connection', stage: 'world_nonce' });
        return {
          peerId: '84',
          signallingProtocol: 'legacy',
          nonce: null,
          sessionAbort: new AbortController(),
          session: { close: () => joinAttempts === 1 ? membershipCleaned : Promise.resolve() }
        };
      },
      createClient() {
        const client = new Client();
        client.nethernet = {};
        clients.push(client);
        queueMicrotask(() => {
          client.emit('minepilot_join_step', 'nethernet_peer');
          client.close('connecterror:14');
        });
        return client;
      }
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(clients.length, 1);
    assert.equal(clients[0].closed, 1);
    assert.equal(snapshots.some(snapshot => snapshot.phase === 'retrying'), false);
    finishCleanup();
    await session;
    assert.equal(verified, 1);
    assert.deepEqual(selected, cancel ? ['first'] : ['first', 'fresh']);
    assert.equal(snapshots.filter(snapshot => snapshot.phase === 'retrying').length, 1);
    assert.deepEqual(snapshots.at(-1), cancel ? { phase: 'stopped' } : {
      phase: 'failed', stage: 'nethernet_peer', reason: 'nethernet_closed', nethernetCode: 14, retried: true
    });
    assert.equal(snapshots.filter(snapshot => snapshot.phase === 'failed').length, cancel ? 0 : 1);
  });
}

test('friend-world join sends the MPSD handle membership request for the exact owner', async context => {
  const { Titles } = require('prismarine-auth');
  const { XboxClient, XboxRTASocket } = require('prismarine-xbox-services');
  const { pickOwnerWorld } = await importRuntimeModule('prismarine-world-client.mjs', 'connection/prismarine-world-client.js');
  const ownerXuid = '2533274790000002';
  const botXuid = '2533274790000001';
  context.mock.method(XboxClient.prototype, 'getProfile', async () => ({ xuid: botXuid, gamertag: 'FixtureBot' }));
  const activity = context.mock.method(XboxClient.prototype, 'getActivityHandles', async () => [
    { id: 'wrong-handle', sessionRef: { name: 'wrong' }, ownerXuid, customProperties: { ownerId: botXuid } },
    { id: 'expected-handle', sessionRef: { name: 'expected' }, customProperties: { ownerId: ownerXuid, protocol: 2225, SupportedConnections: [{ ConnectionType: 3, NetherNetId: '123' }] } }
  ]);
  const subscription = new EventEmitter();
  subscription.initialData = { ConnectionId: 'fixture-rta-connection' };
  subscription.close = context.mock.fn(async () => {});
  context.mock.method(XboxRTASocket.prototype, 'connect', async () => {});
  context.mock.method(XboxRTASocket.prototype, 'subscribe', async () => subscription);
  const rtaClose = context.mock.method(XboxRTASocket.prototype, 'close', async () => {});
  const membership = context.mock.method(XboxClient.prototype, 'request', async (method, url, options) => {
    assert.equal(method, 'PUT');
    assert.equal(url, 'https://sessiondirectory.xboxlive.com/handles/expected-handle/session');
    assert.equal(options.contractVersion, '107');
    assert.deepEqual(options.data.members.me.constants.system, { xuid: botXuid, initialize: true });
    throw Object.assign(new Error('Fixture stops at MPSD membership'), { status: 403 });
  });
  class Authflow {
    async getXboxToken() {}
    async getMinecraftBedrockToken() {
      const payload = Buffer.from(JSON.stringify({ extraData: { XUID: botXuid } })).toString('base64url');
      return { chain: ['fixture', 'header.' + payload + '.signature'], token: 'fixture' };
    }
  }
  const snapshots = [];
  await run({
    ownerXuid,
    publish: snapshot => snapshots.push(snapshot),
    signal: new AbortController().signal,
    authDependencies: { Authflow, XboxClient, XboxRTASocket, Titles },
    createClient: () => assert.fail('Bedrock client must not start after membership rejection'),
    pickOwnerWorld
  });
  assert.equal(activity.mock.callCount(), 1);
  assert.equal(activity.mock.calls[0].arguments[0], botXuid);
  assert.equal(membership.mock.callCount(), 1);
  assert.equal(subscription.close.mock.callCount(), 1);
  assert.equal(rtaClose.mock.callCount(), 1);
  assert.deepEqual(snapshots.at(-1), { phase: 'failed', stage: 'xbox_membership', httpStatus: 403 });
});

test('friend-world JSON-RPC offer targets the matching Xbox PmsgId and filters unrelated peers', { timeout: 10000 }, async context => {
  const { createClient } = require('bedrock-protocol');
  const { NethernetSignal } = require('bedrock-protocol/src/nethernet/signalling');
  const { parseJson } = require('bedrock-protocol/src/nethernet/signallingCodec');
  const { Titles } = require('prismarine-auth');
  const { XboxClient, XboxRTASocket } = require('prismarine-xbox-services');
  const { SignalType, SignalStructure } = require('nethernet');
  const { pickOwnerWorld } = await importRuntimeModule('prismarine-world-client.mjs', 'connection/prismarine-world-client.js');
  const ownerXuid = '2533274790000002';
  const botXuid = '2533274790000001';
  const hostNetworkId = '18446744073709551610';
  const hostPlayerId = '1e95d572-0f41-481e-44c9-a47d46d4fc70';
  const unrelatedPlayerId = '4a62d29e-2f5e-4f2c-87ec-42001f84ff01';
  const botNonce = 'a123b456c789d012';
  context.mock.method(XboxClient.prototype, 'getProfile', async () => ({ xuid: botXuid, gamertag: 'FixtureBot' }));
  context.mock.method(XboxClient.prototype, 'getActivityHandles', async () => [{
    id: 'expected-handle',
    sessionRef: { name: 'expected' },
    customProperties: {
      ownerId: ownerXuid,
      protocol: 2225,
      SupportedConnections: [
        { ConnectionType: 3, NetherNetId: '123' },
        { ConnectionType: 7, NetherNetId: hostNetworkId, PmsgId: hostPlayerId.toUpperCase() }
      ]
    }
  }]);
  const sessionDocument = { properties: { custom: { nonces: { [ownerXuid]: 'deadbeef', [botXuid]: botNonce } } } };
  const latestDocument = { properties: { custom: { nonces: { [ownerXuid]: 'deadbeef', [botXuid]: botNonce } } } };
  const get = context.mock.method(XboxClient.prototype, 'getSession', async () => latestDocument);
  const request = context.mock.method(XboxClient.prototype, 'request', async (method, url, options) => {
    if (method === 'PUT' && url.endsWith('/handles/expected-handle/session')) {
      assert.equal(options.contractVersion, '107');
      assert.equal(options.data.members.me.properties.system.connection, 'fixture-rta-connection');
      return sessionDocument;
    }
    if (method === 'POST' && url === 'https://sessiondirectory.xboxlive.com/handles') return {};
    if (method === 'PUT' && url.endsWith('/sessions/expected')) return {};
    throw new Error('Unexpected Xbox request in fixture');
  });
  const subscription = new EventEmitter();
  subscription.initialData = { ConnectionId: 'fixture-rta-connection' };
  const subscriptionClose = context.mock.fn(async () => {});
  subscription.close = subscriptionClose;
  context.mock.method(XboxRTASocket.prototype, 'connect', async () => {});
  context.mock.method(XboxRTASocket.prototype, 'subscribe', async () => subscription);
  const rtaClose = context.mock.method(XboxRTASocket.prototype, 'close', async () => {});
  const sent = [];
  let client;
  let signedNonce;
  context.mock.method(NethernetSignal.prototype, 'connect', async function () {
    client.createClientUserChain(client.ecdhKeyPair.privateKey);
    signedNonce = JSON.parse(Buffer.from(client.clientUserChain.split('.')[1], 'base64url')).Nonce;
    this.ws = { readyState: 1, terminate() {}, send: text => {
      const frame = parseJson(text);
      sent.push(frame);
      const inner = frame.params?.message && parseJson(frame.params.message);
      const [type, id] = inner?.params?.message?.split(' ') ?? [];
      if (type !== SignalType.ConnectRequest) return;
      const respond = (from, networkId, code) => this.onMessage(JSON.stringify({
        jsonrpc: '2.0', method: 'Signaling_ReceiveMessage_v1_0',
        params: { From: from, Message: JSON.stringify({
          jsonrpc: '2.0', method: 'Signaling_WebRtc_v1_0',
          params: { netherNetId: networkId, message: `CONNECTERROR ${id} ${code}` }
        }) }
      }));
      respond(unrelatedPlayerId, hostNetworkId, 38);
      respond(hostPlayerId.toUpperCase(), hostNetworkId, 37);
      respond(hostPlayerId, '124', 39);
    } };
    this.on('signal', signal => snapshots.push({ testSignal: {
      type: signal.type, connectionId: String(signal.connectionId),
      networkId: String(signal.networkId), data: signal.data
    } }));
    this.emit('credentials', []);
  });
  class Authflow {
    async getXboxToken() {}
    async getMinecraftBedrockToken() {
      const payload = Buffer.from(JSON.stringify({ extraData: { XUID: botXuid } })).toString('base64url');
      return { chain: ['fixture', 'header.' + payload + '.signature'], token: 'fixture' };
    }
  }
  const snapshots = [];
  await run({
    ownerXuid,
    publish: snapshot => snapshots.push(snapshot),
    signal: AbortSignal.timeout(5000),
    authDependencies: { Authflow, XboxClient, XboxRTASocket, Titles },
    createClient: options => {
      assert.equal(options.nethernet.networkId, hostNetworkId);
      assert.equal(options.nethernet._peerPlayerId, hostPlayerId);
      assert.equal(options.nethernet._signallingProtocol, 'jsonrpc');
      client = createClient(options);
      const transport = client.connection.nethernet;
      transport.connect = function () {
        let closed = false;
        this.connection = {
          close: reason => {
            if (closed) return;
            closed = true;
            this.connection = null;
            client.close(reason);
          }
        };
        const offerSdp = [
          'v=0',
          'o=- 0 0 IN IP4 127.0.0.1',
          's=-',
          't=0 0',
          'a=group:BUNDLE 0',
          'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
          'c=IN IP4 0.0.0.0',
          'a=mid:0',
          'a=sctp-port:5000',
          'a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF',
          'a=candidate:1 1 UDP 2122260223 127.0.0.1 12345 typ host'
        ].join('\r\n');
        this.signalHandler(new SignalStructure(
          SignalType.ConnectRequest, this.connectionId, offerSdp, this.serverNetworkId
        ));
      };
      return client;
    },
    pickOwnerWorld
  });
  assert.ok(client, JSON.stringify(snapshots));
  assert.equal(client.connection.nethernet.serverNetworkId, hostPlayerId);
  assert.equal(sent[0]?.method, 'Signaling_SendClientMessage_v1_0', JSON.stringify(snapshots));
  assert.equal(get.mock.callCount(), 0);
  assert.equal(signedNonce, botNonce);
  assert.ok(snapshots.some(event => event.stage === 'world_nonce'));
  assert.ok(!JSON.stringify(snapshots).includes(botNonce));
  assert.ok(sent.every(frame => frame.params.toPlayerId === hostPlayerId));
  const offerFrame = sent.find(frame => {
    const inner = frame.params?.message && parseJson(frame.params.message);
    return inner?.params?.message?.startsWith('CONNECTREQUEST ');
  });
  assert.ok(offerFrame, JSON.stringify(sent));
  const offer = parseJson(offerFrame.params.message).params;
  assert.equal(offer.netherNetId, String(client.connection.nethernet.networkId));
  assert.match(offer.message, /^CONNECTREQUEST /);
  assert.ok(snapshots.some(event => event.step === 'offer_sent'));
  assert.match(offer.message, /^a=candidate:[^\r\n]*127\.0\.0\.1/m);
  const receivedPeerIds = snapshots.filter(event => event.testSignal)
    .map(event => event.testSignal.networkId);
  assert.deepEqual(receivedPeerIds, [hostPlayerId, hostPlayerId]);
  assert.equal(client.connection.nethernet.serverNetworkId, hostPlayerId);
  assert.equal(client.options.nethernet.responseTimeoutMs, 25000);
  assert.equal(client.options.nethernet.inactivityTimeoutMs, 12000);
  assert.deepEqual(snapshots.at(-1), {
    phase: 'failed', stage: 'nethernet_peer', reason: 'nethernet_closed', nethernetCode: 37
  });
  assert.equal(subscriptionClose.mock.callCount(), 1);
  assert.equal(rtaClose.mock.callCount(), 1);
  assert.ok(request.mock.callCount() >= 2);
});

test('signalling keeps legacy numeric destinations and existing Realm UUID routes', () => {
  const { encodeSignal, parseJson, parseJsonRpcReceiveItem } = require('bedrock-protocol/src/nethernet/signallingCodec');
  const { SignalStructure } = require('nethernet');
  const nethernetId = '18446744073709551610';
  const realmId = '1e95d572-0f41-481e-44c9-a47d46d4fc70';
  const signal = SignalStructure.fromString('CONNECTREQUEST 12 fixture');
  signal.networkId = nethernetId;
  assert.match(encodeSignal(signal, 42n, 'legacy', 'request', 'message'), new RegExp(`"To":${nethernetId}`));
  signal.networkId = realmId;
  assert.equal(parseJson(encodeSignal(signal, 42n, 'jsonrpc', 'request', 'message')).params.toPlayerId, realmId);
  assert.equal(parseJsonRpcReceiveItem({ From: realmId, Message: 'CONNECTRESPONSE 12 fixture' }).networkId, realmId);
});


test('uses the Android network addresses to gather a Werift ICE candidate when libuv is denied', async context => {
  const os = require('node:os');
  const denied = Object.assign(new Error('Permission denied'), {
    info: { syscall: 'uv_interface_addresses', errno: 13 }
  });
  const fallback = androidNetworkInterfaces(() => { throw denied; }, () => ['127.0.0.1', 'invalid']);
  assert.deepEqual(fallback(), { android: [{ address: '127.0.0.1', family: 'IPv4', internal: false }] });
  const empty = androidNetworkInterfaces(() => { throw denied; }, () => []);
  assert.throws(empty, error => error === denied);
  const stockInterfaces = { sample: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] };
  assert.equal(androidNetworkInterfaces(() => stockInterfaces, () => assert.fail('Fallback read'))(), stockInterfaces);
  context.mock.method(os, 'networkInterfaces', fallback);
  const { RTCPeerConnection } = require('nethernet/src/webrtc').getWebRTC('werift');
  const peer = new RTCPeerConnection({ iceServers: [] });
  try {
    peer.createDataChannel('runtime-test');
    await peer.setLocalDescription(await peer.createOffer());
    assert.match(peer.localDescription.sdp, /^a=candidate:.*127\.0\.0\.1/m);
  } finally {
    await peer.close();
  }
});


test('Android join process reuses its authenticated client for gameplay observations', async t => {
  const { mkdtempSync, rmSync } = require('node:fs');
  const { join } = require('node:path');
  const dir = mkdtempSync(join(require('node:os').tmpdir(), 'minepilot-live-bridge-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const client = new Client();
  const controller = new AbortController();
  const observations = [];
  const session = observeSession(client, state => observations.push(state),
    controller.signal, () => 'connection', 2000, {
      commandPath: join(dir, 'gameplay-command.json'),
      receiptPath: join(dir, 'gameplay-receipt.json'),
    });
  client.emit('start_game', { runtime_entity_id: 123n,
    player_position: { x: 14, y: 65, z: 7 }, dimension: 0,
    current_tick: 200n, movement_authority: 1 });
  client.emit('level_chunk', { x: 0, z: 0, dimension: 0 });
  client.emit('spawn');
  assert.equal(observations.at(-1).gameplay.state, 'observing');
  assert.deepEqual(observations.at(-1).gameplay.position, { x: 14, y: 65, z: 7 });
  assert.equal(observations.at(-1).gameplay.movement, 'unavailable');
  controller.abort();
  assert.equal((await session).phase, 'stopped');
  assert.equal(client.listenerCount('correct_player_move_prediction'), 0);
  assert.equal(client.listenerCount('add_player'), 0);
  assert.equal(client.closed, 1);
});
