import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFriendWorldRuntime } from '../src/connection/friend-world-runtime-check.js';

test('runtime check fails closed when SDK is unavailable', () => {
  const status = checkFriendWorldRuntime(24, () => { throw new Error('module not installed'); });
  assert.equal(status.readyForNodeJoinAttempt, false);
  assert.equal(status.sdkInstalled, false);
  assert.equal(status.androidEmbedded, false);
  assert.match(status.issues.join(' '), /module not installed/);
});
test('runtime check distinguishes Node SDK availability from Android embedding', () => {
  const status = checkFriendWorldRuntime(24, () => ({ createClient() {} }));
  assert.equal(status.readyForNodeJoinAttempt, true);
  assert.equal(status.androidEmbedded, false);
});
test('runtime check rejects older Node and missing createClient', () => {
  assert.equal(checkFriendWorldRuntime(22, () => ({ createClient() {} })).readyForNodeJoinAttempt, false);
  assert.equal(checkFriendWorldRuntime(24, () => ({})).readyForNodeJoinAttempt, false);
});
