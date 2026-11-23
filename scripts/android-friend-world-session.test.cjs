'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { androidNetworkInterfaces, observeSession, run, validateOwner } = require('./friend-world-session.cjs');
const { runtimeLogger } = require('./xbox-auth-probe.cjs');

class Client extends EventEmitter {
  closed = 0;
  close() {
    this.closed++;
    this.emit('close');
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

test('captures the Bedrock disconnect code without forwarding the server message', async () => {
  const client = new Client();
  const session = observeSession(client, () => {}, new AbortController().signal, () => 'connection');
  client.emit('loggingIn');
  client.emit('kick', { reason: 'nonce_missing', message: 'private server text' });
  assert.deepEqual(await session, {
    phase: 'failed', stage: 'bedrock_login', reason: 'host_disconnect', bedrockCode: 136
  });
});

test('hands the verified account to the friend-world SDK with exact owner selection', async () => {
  const { pickOwnerWorld } = await import('./prismarine-world-client.mjs');
  const client = new Client();
  const snapshots = [];
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
    createClient(options) {
      queueMicrotask(async () => {
        assert.equal(options.authflow, auth);
        assert.equal(options.authTitle, 'android');
        assert.equal(options.offline, false);
        const session = { sessionRef: { name: 'target' }, customProperties: { ownerId: '84', protocol: 2225 } };
        assert.equal(options.world.pickSession([
          { sessionRef: { name: 'other' }, ownerXuid: '84', customProperties: { ownerId: '55' } },
          session
        ]), session);
        client.emit('start_game');
        client.emit('spawn');
        client.emit('close');
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
    const controller = new AbortController();
    const snapshots = [];
    const clients = [];
    const selected = [];
    let finishCleanup;
    let verified = 0;
    const membershipCleaned = new Promise(resolve => {
      finishCleanup = resolve;
    });
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
    const session = run({
      ownerXuid: '84',
      signal: controller.signal,
      publish(snapshot) {
        snapshots.push(snapshot);
        if (cancel && snapshot.phase === 'retrying') controller.abort();
      },
      authDependencies: { Authflow, XboxClient, Titles: { MinecraftAndroid: 'android' } },
      pickOwnerWorld(sessions, ownerXuid) {
        assert.equal(ownerXuid, '84');
        selected.push(sessions[0]);
        return sessions[0];
      },
      createClient(options) {
        const client = new Client();
        clients.push(client);
        if (clients.length === 1) client._nethernetCleanup = membershipCleaned;
        queueMicrotask(() => {
          options.world.pickSession([clients.length === 1 ? 'first' : 'fresh']);
          client.emit('minepilot_join_step', 'nethernet_peer');
          client.emit('error', Object.assign(new Error('NetherNet peer closed'), { nethernetCode: 14 }));
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

test('packaged Bedrock SDK reaches the Xbox membership request for the selected owner', async context => {
  const { createClient } = require('bedrock-protocol');
  const { Titles } = require('prismarine-auth');
  const { XboxClient } = require('prismarine-xbox-services');
  const { pickOwnerWorld } = await import('./prismarine-world-client.mjs');
  const ownerXuid = '2533274790000002';
  const botXuid = '2533274790000001';
  context.mock.method(XboxClient.prototype, 'getProfile', async () => ({ xuid: botXuid, gamertag: 'FixtureBot' }));
  const activity = context.mock.method(XboxClient.prototype, 'getActivityHandles', async () => [
    { sessionRef: { name: 'wrong' }, ownerXuid, customProperties: { ownerId: botXuid } },
    { sessionRef: { name: 'expected' }, customProperties: { ownerId: ownerXuid, protocol: 2225 } }
  ]);
  const membership = context.mock.method(XboxClient.prototype, 'joinSession', async () => {
    throw Object.assign(new Error('Fixture stops before Xbox membership'), { status: 403 });
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
    authDependencies: { Authflow, XboxClient, Titles },
    createClient,
    pickOwnerWorld
  });
  assert.equal(activity.mock.callCount(), 1, JSON.stringify(snapshots));
  assert.equal(activity.mock.calls[0].arguments[0], botXuid);
  assert.equal(membership.mock.callCount(), 1, JSON.stringify(snapshots));
  assert.equal(membership.mock.calls[0].arguments[0], 'expected');
  assert.deepEqual(snapshots.at(-1), { phase: 'failed', stage: 'xbox_membership', httpStatus: 403 });
});

test('packaged SDK routes the offer to the Xbox messaging ID and accepts the matching peer', { timeout: 10000 }, async context => {
  const os = require('node:os');
  const { createClient } = require('bedrock-protocol');
  const { NethernetSignal } = require('bedrock-protocol/src/nethernet/signalling');
  const { parseJson } = require('bedrock-protocol/src/nethernet/signallingCodec');
  const { Titles } = require('prismarine-auth');
  const { XboxClient } = require('prismarine-xbox-services');
  const { SignalType } = require('nethernet');
  const { pickOwnerWorld } = await import('./prismarine-world-client.mjs');
  const ownerXuid = '2533274790000002';
  const botXuid = '2533274790000001';
  const hostNetworkId = '18446744073709551610';
  const hostPlayerId = '1e95d572-0f41-481e-44c9-a47d46d4fc70';
  const botNonce = 'a123b456c789d012';
  context.mock.method(os, 'networkInterfaces', () => ({
    fixture: [{ address: '127.0.0.1', family: 'IPv4', internal: false }]
  }));
  context.mock.method(XboxClient.prototype, 'getProfile', async () => ({ xuid: botXuid, gamertag: 'FixtureBot' }));
  context.mock.method(XboxClient.prototype, 'getActivityHandles', async () => [
    { sessionRef: { name: 'expected' }, customProperties: { ownerId: ownerXuid, protocol: 2225 } }
  ]);
  const membership = new EventEmitter();
  membership.current = { properties: { custom: { SupportedConnections: [
    { ConnectionType: 3, NetherNetId: '123' },
    { ConnectionType: 7, NetherNetId: hostNetworkId, PmsgId: hostPlayerId }
  ] } } };
  membership.current.properties.custom.nonces = { [ownerXuid]: 'deadbeef' };
  const get = context.mock.fn(async () => {
    const document = structuredClone(membership.current);
    document.properties.custom.nonces[botXuid] = botNonce;
    return document;
  });
  membership.get = get;
  const close = context.mock.fn();
  membership.close = close;
  context.mock.method(XboxClient.prototype, 'joinSession', async () => membership);
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
      respond('4a62d29e-2f5e-4f2c-87ec-42001f84ff01', hostNetworkId, 38);
      respond(hostPlayerId, '124', 39);
      respond(hostPlayerId.toUpperCase(), hostNetworkId, 37);
    } };
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
    authDependencies: { Authflow, XboxClient, Titles },
    createClient: options => { client = createClient(options); return client; },
    pickOwnerWorld
  });
  assert.equal(sent[0]?.method, 'Signaling_SendClientMessage_v1_0', JSON.stringify(snapshots));
  assert.equal(get.mock.callCount(), 1);
  assert.equal(signedNonce, botNonce);
  assert.ok(snapshots.some(event => event.stage === 'world_nonce'));
  assert.ok(!JSON.stringify(snapshots).includes(botNonce));
  assert.equal(sent[0].params.toPlayerId, hostPlayerId);
  const offer = parseJson(sent[0].params.message).params;
  assert.equal(offer.netherNetId, String(client.connection.nethernet.networkId));
  assert.match(offer.message, /^CONNECTREQUEST /);
  assert.ok(snapshots.some(event => event.step === 'offer_sent'));
  assert.match(offer.message, /^a=candidate:.*127\.0\.0\.1/m);
  assert.equal(client.connection.nethernet.responseTimeoutMs, 25000);
  assert.equal(client.connection.nethernet.inactivityTimeoutMs, 12000);
  assert.deepEqual(snapshots.at(-1), {
    phase: 'failed', stage: 'nethernet_peer', reason: 'nethernet_closed', nethernetCode: 37
  });
  assert.equal(close.mock.callCount(), 1);
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
