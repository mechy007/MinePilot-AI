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
