import test from 'node:test';
import assert from 'node:assert/strict';
import { SdkBedrockTransport, type BedrockSdkBridge } from '../src/connection/sdk-transport.js';
import { BedrockConnectionDriver } from '../src/connection/bedrock-driver.js';
import { ConnectionController } from '../src/connection/controller.js';

test('SDK bridge wires login, owner discovery, join and spawn', async () => {
  const calls: string[] = [];
  const sdk: BedrockSdkBridge = {
    async login() { calls.push('login'); },
    async getFriendSessions() { calls.push('sessions'); return [{sessionId:'owner-session', hostXuid:'42'}]; },
    async joinFriendSession(id) { calls.push('join:' + id); },
    async waitUntilSpawned() { calls.push('spawn'); },
    async disconnect() { calls.push('disconnect'); }
  };
  const controller = new ConnectionController(new BedrockConnectionDriver(new SdkBedrockTransport(sdk), '42'));
  await controller.start();
  assert.equal(controller.state, 'ready');
  assert.deepEqual(calls, ['login', 'sessions', 'join:owner-session', 'spawn']);
  controller.stop();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(calls.at(-1), 'disconnect');
});
test('SDK transport rejects malformed friend session metadata', async () => {
  const sdk: BedrockSdkBridge = {
    async login() {},
    async getFriendSessions() { return [{ sessionId: '', hostXuid: '42' }]; },
    async joinFriendSession() {},
    async waitUntilSpawned() {},
    async disconnect() {}
  };
  await assert.rejects(new SdkBedrockTransport(sdk).listFriendSessions(new AbortController().signal), /Invalid Xbox session metadata/);
});
test('SDK transport refuses aborted login and join', async () => {
  const sdk: BedrockSdkBridge = {
    async login() { throw new Error('must not call'); },
    async getFriendSessions() { return []; },
    async joinFriendSession() { throw new Error('must not call'); },
    async waitUntilSpawned() {},
    async disconnect() {}
  };
  const signal = AbortSignal.abort();
  const transport = new SdkBedrockTransport(sdk);
  await assert.rejects(transport.authenticate(signal), /cancelled/);
  await assert.rejects(transport.join({sessionId:'s',hostXuid:'42'}, signal), /cancelled/);
});
