import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionDiagnostics } from '../src/connection/diagnostics.js';
test('records bounded structured diagnostics', () => {
  const d = new ConnectionDiagnostics(2);
  d.record('authenticating', 'info', 'AUTH_STARTED', 1);
  d.record('discovering', 'info', 'AUTH_DONE', 2);
  d.record('failed', 'error', 'SESSION_MISSING', 3);
  assert.deepEqual(d.snapshot().map(e => e.code), ['AUTH_DONE', 'SESSION_MISSING']);
});
test('rejects secrets or free-form error messages as codes', () => {
  const d = new ConnectionDiagnostics();
  assert.throws(() => d.record('failed', 'error', 'Bearer secret-token'));
  assert.throws(() => d.record('failed', 'error', 'xuid:123456'));
});
test('returned events cannot mutate stored history', () => {
  const d = new ConnectionDiagnostics();
  d.record('ready', 'info', 'READY', 1);
  const events = d.snapshot() as { code: string }[];
  events[0].code = 'CHANGED';
  assert.equal(d.snapshot()[0].code, 'READY');
});
