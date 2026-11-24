'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  BedrockStackRequestManager, BedrockStackRequestError, normalizeAction,
  LEGACY_ACTION_IDS_1_26_60
} = require('./bedrock-stack-request-manager.cjs');

class Client extends EventEmitter {
  sent = [];
  queue(name, payload) { this.sent.push({ name, payload }); }
}
const slot = (container_id, index, stack_id = 0) => ({
  slot_type: { container_id }, slot: index, stack_id
});

test('normalizes Bedrock 1.26.60 action IDs and validates slot addresses', () => {
  const action = normalizeAction({ type_id: 'take', count: 1,
    source: slot('inventory', 9, 31), destination: slot('hotbar', 0, 0) });
  assert.equal(action.legacy_type_id, 0);
  const strict = normalizeAction({ type_id: 'take', legacy_type_id: 255, count: 1,
    source: slot('inventory', 9, 31), destination: slot('hotbar', 0, 0), injected: 'ignored' });
  assert.equal(strict.legacy_type_id, 0);
  assert.equal(Object.hasOwn(strict, 'injected'), false);
  assert.deepEqual(action.source, { slot_type: { container_id: 'inventory' }, slot: 9, stack_id: 31 });
  assert.equal(normalizeAction({ type_id: 'craft_recipe', recipe_network_id: 42 }).legacy_type_id, 12);
  assert.equal(normalizeAction({ type_id: 'craft_recipe', recipe_network_id: 42 }).times_crafted, 1);
  assert.equal(LEGACY_ACTION_IDS_1_26_60.results_deprecated, 20);
  assert.throws(() => normalizeAction({ type_id: 'take', count: 0,
    source: slot('inventory', 9), destination: slot('hotbar', 0) }), /count/);
  assert.throws(() => normalizeAction({ type_id: 'craft_recipe', recipe_network_id: -1 }), /recipe network id/);
  assert.throws(() => normalizeAction({ type_id: 'execute_javascript' }), /unsupported action/);
  assert.throws(() => normalizeAction({ type_id: 'take', count: 1,
    source: slot('inventory', 256), destination: slot('hotbar', 0) }), /slot/);
});

test('does not send inventory requests unless StartGame negotiated server authority', async () => {
  const client = new Client();
  const manager = new BedrockStackRequestManager(client, { isEnabled: () => false });
  await assert.rejects(manager.send([{ type_id: 'take', count: 1,
    source: slot('inventory', 9), destination: slot('hotbar', 0) }]),
    error => error instanceof BedrockStackRequestError && error.outcome === 'unsupported');
  assert.equal(client.sent.length, 0);
  manager.close();
});

test('correlates one server-authoritative request and resolves only its matching response', async () => {
  const client = new Client();
  const manager = new BedrockStackRequestManager(client, { isEnabled: () => true });
  const pending = manager.send([{ type_id: 'take', count: 1,
    source: slot('inventory', 9, 31), destination: slot('hotbar', 0, 0) }]);
  assert.equal(client.sent.length, 1);
  assert.equal(client.sent[0].name, 'item_stack_request');
  const request = client.sent[0].payload.requests[0];
  assert.equal(request.request_id, -1);
  assert.equal(request.actions[0].legacy_type_id, 0);
  assert.equal(manager.snapshot().pending, true);
  client.emit('item_stack_response', { responses: [
    { request_id: 99, status: 'ok', containers: [] },
    { request_id: -1, status: 'ok', containers: [{ slot_type: { container_id: 'hotbar' }, slots: [] }] }
  ] });
  const response = await pending;
  assert.equal(response.request_id, -1);
  assert.equal(manager.snapshot().pending, false);
  assert.equal(manager.snapshot().lastOutcome, 'ok');
  manager.close();
});

test('rejects server errors and refuses overlapping requests', async () => {
  const client = new Client();
  const manager = new BedrockStackRequestManager(client, { isEnabled: () => true });
  const actions = [{ type_id: 'take', count: 1,
    source: slot('inventory', 9, 31), destination: slot('hotbar', 0, 0) }];
  const pending = manager.send(actions);
  await assert.rejects(manager.send(actions), /stack_request_busy/);
  client.emit('item_stack_response', { responses: [{ request_id: -1, status: 49 }] });
  await assert.rejects(pending, error => error.outcome === 'server_rejected' && error.status === 49);
  assert.equal(manager.snapshot().lastOutcome, 'server_rejected');
  manager.close();
});

test('times out and closes pending requests without claiming success', async () => {
  const client = new Client();
  const manager = new BedrockStackRequestManager(client, { isEnabled: () => true, timeoutMs: 100 });
  const actions = [{ type_id: 'take', count: 1,
    source: slot('inventory', 9, 31), destination: slot('hotbar', 0, 0) }];
  const timed = manager.send(actions);
  await assert.rejects(timed, error => error.outcome === 'timeout');
  assert.equal(manager.snapshot().lastOutcome, 'timeout');
  const closed = manager.send(actions);
  client.emit('close');
  await assert.rejects(closed, error => error.outcome === 'closed');
  assert.equal(manager.snapshot().pending, false);
  manager.close();
});
