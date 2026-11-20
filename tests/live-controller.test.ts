import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveConnectionController } from '../src/connection/live-controller.js';
import { type ConnectionDriver } from '../src/connection/controller.js';
const mockDriver: ConnectionDriver = {
  async authenticate() {}, async discoverOwnerSession() {}, async connect() {}, async waitForSpawn() {}
};
test('live controller rejects absent or incomplete transport capabilities', () => {
  assert.throws(() => createLiveConnectionController(mockDriver), /Live Bedrock connection unavailable/);
  assert.throws(() => createLiveConnectionController(mockDriver, {
    microsoft_auth: true, xbox_friend_discovery: true, bedrock_join: false, spawn_confirmation: true
  }), /bedrock_join/);
});
test('live controller permits an explicitly complete transport declaration', async () => {
  const c = createLiveConnectionController(mockDriver, {
    microsoft_auth: true, xbox_friend_discovery: true, bedrock_join: true, spawn_confirmation: true
  });
  await c.start();
  assert.equal(c.state, 'ready');
  c.stop();
});
