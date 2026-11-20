import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionMachine } from '../src/connection/state-machine.js';
import { selectOwnerSession } from '../src/connection/session-selection.js';
test('connection lifecycle reaches ready', () => {
  const m = new ConnectionMachine();
  for (const event of ['START','AUTH_OK','SESSION_FOUND','CONNECTED','SPAWNED'] as const) m.transition(event);
  assert.equal(m.state, 'ready');
  m.transition('DISCONNECT');
  assert.equal(m.state, 'disconnected');
});
test('invalid transitions fail closed', () => {
  const m = new ConnectionMachine();
  assert.throws(() => m.transition('READY'));
  assert.equal(m.state, 'disconnected');
});
test('session selection uses authenticated owner XUID', () => {
  const selected = selectOwnerSession([{sessionId:'wrong',hostXuid:'100'}, {sessionId:'correct',hostXuid:'200'}], '200');
  assert.equal(selected.sessionId, 'correct');
  assert.throws(() => selectOwnerSession([{sessionId:'wrong',hostXuid:'100'}], '200'));
});
test('ambiguous owner sessions require explicit selection', () => {
  assert.throws(() => selectOwnerSession([{sessionId:'1',hostXuid:'200'}, {sessionId:'2',hostXuid:'200'}], '200'));
});
