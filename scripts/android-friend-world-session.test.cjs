'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { observeSession, run, validateOwner } = require('./friend-world-session.cjs');

class Client extends EventEmitter {
  closed = 0;
  close() {
    this.closed++;
    this.emit('close');
  }
}

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
  assert.deepEqual(snapshots.at(-1), { phase: 'stopped', stage: 'connection' });
  completeCleanup();
  await session;
});

test('reports a safe failure on a disconnect before the world starts', async () => {
  const client = new Client();
  const snapshots = [];
  const session = observeSession(client, state => snapshots.push(state), new AbortController().signal, () => 'connection');
  client.emit('close');
  await session;
  assert.deepEqual(snapshots, [{ phase: 'failed', stage: 'connection' }]);
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
    async getProfile() { return { xuid: '42', gamertag: 'Bot' }; }
  }
  await run({
    ownerXuid: '84',
    publish: snapshot => snapshots.push(snapshot),
    signal: new AbortController().signal,
    authDependencies: { Authflow, XboxClient, Titles: { MinecraftAndroid: 'android' } },
    pickOwnerWorld,
    createClient(options) {
      queueMicrotask(() => {
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
    throw new Error('Fixture stops before Xbox membership');
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
  assert.deepEqual(snapshots.at(-1), { phase: 'failed', stage: 'connection' });
});
