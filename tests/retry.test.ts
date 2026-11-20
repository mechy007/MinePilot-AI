import test from 'node:test';
import assert from 'node:assert/strict';
import { retryDelay, waitForRetry } from '../src/connection/retry.js';
test('retry delay increases with cap and attempt limit', () => {
  assert.equal(retryDelay(1), 1000);
  assert.equal(retryDelay(2), 2000);
  assert.equal(retryDelay(6), 30000);
  assert.equal(retryDelay(7), null);
});
test('invalid retry policies and attempts are rejected', () => {
  assert.throws(() => retryDelay(0));
  assert.throws(() => retryDelay(1, { initialDelayMs: 0, maxDelayMs: 100, maxAttempts: 3 }));
});
test('cancelled retry stops immediately', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(waitForRetry(1000, controller.signal), /cancelled/);
});
test('retry timer is cancellable while waiting', async () => {
  const controller = new AbortController();
  const pending = waitForRetry(10000, controller.signal);
  controller.abort();
  await assert.rejects(pending, /cancelled/);
});
