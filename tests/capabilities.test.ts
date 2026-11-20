import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLiveConnectionSupported, missingConnectionCapabilities, UNIMPLEMENTED_TRANSPORT_CAPABILITIES } from '../src/connection/capabilities.js';
test('placeholder transport never claims live connectivity', () => {
  assert.deepEqual(missingConnectionCapabilities(UNIMPLEMENTED_TRANSPORT_CAPABILITIES), [
    'microsoft_auth', 'xbox_friend_discovery', 'bedrock_join', 'spawn_confirmation'
  ]);
  assert.throws(() => assertLiveConnectionSupported(UNIMPLEMENTED_TRANSPORT_CAPABILITIES), /unavailable/);
});
test('partial implementation remains blocked', () => {
  const report = { ...UNIMPLEMENTED_TRANSPORT_CAPABILITIES, microsoft_auth: true };
  assert.deepEqual(missingConnectionCapabilities(report), [
    'xbox_friend_discovery', 'bedrock_join', 'spawn_confirmation'
  ]);
  assert.throws(() => assertLiveConnectionSupported(report));
});
test('all explicitly reported capabilities permit live connection attempt', () => {
  const report = {
    microsoft_auth: true, xbox_friend_discovery: true,
    bedrock_join: true, spawn_confirmation: true
  };
  assert.deepEqual(missingConnectionCapabilities(report), []);
  assert.doesNotThrow(() => assertLiveConnectionSupported(report));
});
