import test from 'node:test';
import assert from 'node:assert/strict';
import { BedrockConnectionDriver, type BedrockSessionTransport } from '../src/connection/bedrock-driver.js';
import { ConnectionController } from '../src/connection/controller.js';
test('driver selects owner Xbox session before joining', async () => {
  const joined: string[] = [];
  const transport: BedrockSessionTransport = {
    async authenticate() {},
    async listFriendSessions() { return [{ sessionId: 'other', hostXuid: '1' }, { sessionId: 'mine', hostXuid: '2' }]; },
    async join(s) { joined.push(s.sessionId); },
    async awaitSpawn() {}
  };
  const c = new ConnectionController(new BedrockConnectionDriver(transport, '2'));
  await c.start();
  assert.equal(c.state, 'ready');
  assert.deepEqual(joined, ['mine']);
});
test('driver fails closed when owner session is unavailable', async () => {
  const transport: BedrockSessionTransport = {
    async authenticate() {},
    async listFriendSessions() { return [{ sessionId: 'other', hostXuid: '1' }]; },
    async join() { throw new Error('Should never join'); },
    async awaitSpawn() {}
  };
  const c = new ConnectionController(new BedrockConnectionDriver(transport, '2'),
    { initialDelayMs: 1, maxDelayMs: 1, maxAttempts: 1 });
  await c.start();
  assert.equal(c.state, 'failed');
});

test('selected session cannot be reused after join attempt fails', async () => {
  let joins = 0;
  const driver = new BedrockConnectionDriver({
    async authenticate() {},
    async listFriendSessions() { return [{ sessionId: 'mine', hostXuid: '2' }]; },
    async join() { joins++; throw new Error('network unavailable'); },
    async awaitSpawn() {}
  }, '2');
  const signal = new AbortController().signal;
  await driver.authenticate(signal);
  await driver.discoverOwnerSession(signal);
  await assert.rejects(driver.connect(signal), /network unavailable/);
  await assert.rejects(driver.connect(signal), /No selected owner session/);
  assert.equal(joins, 1);
});
test('failed rediscovery clears previously selected session', async () => {
  let discoveries = 0;
  let joins = 0;
  const driver = new BedrockConnectionDriver({
    async authenticate() {},
    async listFriendSessions() {
      return ++discoveries === 1 ? [{ sessionId: 'mine', hostXuid: '2' }] : [];
    },
    async join() { joins++; },
    async awaitSpawn() {}
  }, '2');
  const signal = new AbortController().signal;
  await driver.authenticate(signal);
  await driver.discoverOwnerSession(signal);
  await assert.rejects(driver.discoverOwnerSession(signal), /Owner session not found/);
  await assert.rejects(driver.connect(signal), /No selected owner session/);
  assert.equal(joins, 0);
});
