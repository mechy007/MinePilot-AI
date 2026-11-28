'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const {
  createJoinBody,
  joinFriendWorld,
  readSessionNonce,
  selectFriendWorldConnection,
  waitForWorldNonce
} = require('./android-friend-world-join.cjs');

const OWNER = '2533274790000002';
const BOT = '2533274790000001';
const PMSG = '1e95d572-0f41-481e-44c9-a47d46d4fc70';
const NETWORK = '18446744073709551610';

class FakeRta extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.closed = 0;
    this.subscription = new EventEmitter();
    this.subscription.initialData = { ConnectionId: 'rta-connection-1' };
    this.subscription.closed = 0;
    this.subscription.close = async () => { this.subscription.closed++; };
  }
  async connect(options) { this.connected = true; this.connectOptions = options; }
  async subscribe(uri, options) {
    this.uri = uri;
    this.subscribeOptions = options;
    return this.subscription;
  }
  async close() { this.closed++; }
}

function handle(connections = [
  { ConnectionType: 3, NetherNetId: '123' },
  { ConnectionType: 7, NetherNetId: NETWORK, PmsgId: PMSG.toUpperCase() }
]) {
  return {
    id: 'activity-handle-1',
    ownerXuid: OWNER,
    sessionRef: { scid: '4fc10100-5f7a-4470-899b-280835760c07', templateName: 'MinecraftLobby', name: 'friend-world' },
    customProperties: { ownerId: OWNER, protocol: 2225, SupportedConnections: connections }
  };
}

test('selects JSON-RPC PmsgId ahead of legacy NetherNet entries', () => {
  assert.deepEqual(selectFriendWorldConnection(handle().customProperties), {
    connectionType: 7, networkId: NETWORK, peerId: PMSG, signallingProtocol: 'jsonrpc'
  });
});

test('falls back to legacy NetherNet ID when a type-7 handle has no valid PmsgId', () => {
  assert.deepEqual(selectFriendWorldConnection({
    SupportedConnections: [
      { ConnectionType: 7, NetherNetId: NETWORK, PmsgId: 'not-a-guid' },
      { ConnectionType: 3, NetherNetId: '123' }
    ]
  }), { connectionType: 7, networkId: NETWORK, peerId: NETWORK, signallingProtocol: 'legacy' });
  assert.equal(selectFriendWorldConnection({ SupportedConnections: [
    { ConnectionType: 4, NetherNetId: '123' },
    { ConnectionType: 3, NetherNetId: '0' }
  ] }), null);
});

test('builds the RTA-bound MPSD member body without changing the supplied IDs', () => {
  assert.deepEqual(createJoinBody(BOT, 'connection-id', 'SUBSCRIPTION-ID'), {
    members: {
      me: {
        constants: { system: { xuid: BOT, initialize: true } },
        properties: {
          system: {
            active: true,
            connection: 'connection-id',
            subscription: { id: 'SUBSCRIPTION-ID', changeTypes: ['everything'] }
          }
        }
      }
    }
  });
});

test('waits for the host nonce on an RTA tap and ignores other players', async () => {
  const subscription = new EventEmitter();
  const rta = new EventEmitter();
  const reads = [];
  const xbox = {
    async getSession(name) {
      reads.push(name);
      return { properties: { custom: { nonces: { [OWNER]: 'owner-nonce', [BOT]: 'bot-nonce' } } } };
    }
  };
  const pending = waitForWorldNonce({
    xbox, sessionName: 'friend-world', xuid: BOT,
    session: { properties: { custom: { nonces: { [OWNER]: 'owner-nonce' } } } },
    subscription, rta, timeoutMs: 1000
  });
  assert.equal(await pending, 'bot-nonce');
  assert.deepEqual(reads, ['friend-world']);
});

test('retries a nonce read when an RTA notification arrives during an outstanding read', async () => {
  const subscription = new EventEmitter();
  const rta = new EventEmitter();
  let resolveFirst;
  let reads = 0;
  const xbox = {
    getSession() {
      reads++;
      if (reads === 1) return new Promise(resolve => { resolveFirst = resolve; });
      return Promise.resolve({ properties: { custom: { nonces: { [BOT]: 'late-host-nonce' } } } });
    }
  };
  const pending = waitForWorldNonce({
    xbox, sessionName: 'friend-world', xuid: BOT,
    session: { properties: { custom: { nonces: {} } } },
    subscription, rta, timeoutMs: 1000
  });
  await new Promise(resolve => setImmediate(resolve));
  subscription.emit('data', {});
  resolveFirst({ properties: { custom: { nonces: {} } } });
  assert.equal(await pending, 'late-host-nonce');
  assert.equal(reads, 2);
});

test('retries a failed RTA membership rebind before committing its connection ID', async () => {
  const rta = new FakeRta();
  let updates = 0;
  const xbox = {
    async getActivityHandles() { return [handle()]; },
    async request() { return { properties: { custom: { nonces: { [BOT]: 'nonce' } } } }; },
    async setActivity() {},
    async updateSession(name, body) {
      if (body.members.me?.properties?.system?.connection) {
        updates++;
        if (updates === 1) throw new Error('temporary membership update failure');
      }
    }
  };
  const prepared = await joinFriendWorld({
    xbox, profile: { xuid: BOT }, ownerXuid: OWNER,
    XboxRTASocket: class { constructor() { return rta; } },
    pickOwnerWorld(handles) { return handles[0]; },
    signal: new AbortController().signal
  });
  rta.subscription.emit('ready', { ConnectionId: 'rta-connection-2' });
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(updates, 2, 'failed rebind is retried and then committed');
  await prepared.session.close();
});

test('joins the activity handle, retains RTA membership, updates reconnect IDs and leaves on close', async () => {
  const rta = new FakeRta();
  const calls = [];
  const initial = { properties: { custom: { nonces: { [OWNER]: 'owner-nonce' } } } };
  const latest = { properties: { custom: { nonces: { [OWNER]: 'owner-nonce', [BOT]: 'bot-nonce' } } } };
  const xbox = {
    async getActivityHandles(xuid) {
      assert.equal(xuid, BOT);
      return [handle()];
    },
    async request(method, url, options) {
      calls.push({ method, url, options });
      assert.equal(method, 'PUT');
      assert.equal(url, 'https://sessiondirectory.xboxlive.com/handles/activity-handle-1/session');
      assert.equal(options.contractVersion, '107');
      assert.equal(options.data.members.me.properties.system.connection, 'rta-connection-1');
      return initial;
    },
    async getSession(name) {
      assert.equal(name, 'friend-world');
      return latest;
    },
    async setActivity(name) {
      assert.equal(name, 'friend-world');
    },
    async updateSession(name, body) {
      calls.push({ method: 'UPDATE_SESSION', name, body });
    }
  };
  const stages = [];
  const snapshots = [];
  const prepared = await joinFriendWorld({
    xbox, profile: { xuid: BOT }, ownerXuid: OWNER, XboxRTASocket: class { constructor() { return rta; } },
    pickOwnerWorld(handles, xuid) {
      assert.equal(xuid, OWNER);
      return handles[0];
    },
    publish: snapshot => snapshots.push(snapshot),
    onStage: stage => stages.push(stage),
    signal: new AbortController().signal
  });

  assert.equal(prepared.peerId, PMSG);
  assert.equal(prepared.signallingProtocol, 'jsonrpc');
  assert.equal(prepared.nonce, 'bot-nonce');
  assert.deepEqual(stages, ['discovery', 'world_transport', 'xbox_membership', 'world_nonce']);
  assert.equal(rta.connected, true);
  assert.equal(calls.length, 1);
  assert.equal(readSessionNonce(latest, BOT), 'bot-nonce');

  rta.subscription.emit('ready', { ConnectionId: 'rta-connection-2' });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls.some(call => call.method === 'UPDATE_SESSION' &&
    call.body.members.me.properties.system.connection === 'rta-connection-2'));

  await prepared.session.close();
  await prepared.session.close();
  assert.equal(rta.subscription.closed, 1);
  assert.equal(rta.closed, 1);
  assert.ok(calls.some(call => call.method === 'UPDATE_SESSION' &&
    call.body.members.me === null));
});

test('reconciles the latest RTA ConnectionId when reconnect happens during nonce wait', async () => {
  const rta = new FakeRta();
  const calls = [];
  const xbox = {
    async getActivityHandles() { return [handle()]; },
    async request() { return { properties: { custom: { nonces: {} } } }; },
    async getSession() {
      rta.subscription.initialData = { ConnectionId: 'rta-connection-after-reconnect' };
      return { properties: { custom: { nonces: { [BOT]: 'late-nonce' } } } };
    },
    async setActivity() {},
    async updateSession(name, body) { calls.push(body); }
  };
  const prepared = await joinFriendWorld({
    xbox, profile: { xuid: BOT }, ownerXuid: OWNER,
    XboxRTASocket: class { constructor() { return rta; } },
    pickOwnerWorld(handles) { return handles[0]; },
    signal: new AbortController().signal
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls.some(body =>
    body.members.me?.properties?.system?.connection === 'rta-connection-after-reconnect'));
  await prepared.session.close();
});

test('handles an RTA error as a recoverable session failure and cleans up membership', async () => {
  const rta = new FakeRta();
  const calls = [];
  const xbox = {
    async getActivityHandles() { return [handle()]; },
    async request() { return { properties: { custom: { nonces: { [BOT]: 'nonce' } } } }; },
    async setActivity() {},
    async updateSession(name, body) { calls.push(body); }
  };
  const snapshots = [];
  const prepared = await joinFriendWorld({
    xbox, profile: { xuid: BOT }, ownerXuid: OWNER,
    XboxRTASocket: class { constructor() { return rta; } },
    pickOwnerWorld(handles) { return handles[0]; },
    publish: snapshot => snapshots.push(snapshot),
    signal: new AbortController().signal
  });
  rta.emit('error', new Error('simulated RTA reconnect failure'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(snapshots.some(snapshot =>
    snapshot.phase === 'failed' && snapshot.stage === 'world_transport'));
  assert.equal(rta.closed, 1);
  assert.ok(calls.some(body => body.members.me === null));
  await prepared.session.close();
});
