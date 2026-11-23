'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { test } = require('node:test');
const { BedrockGameplayBridge } = require('./bedrock-gameplay-bridge.cjs');
const { ExperimentalPlayerInput, buildInputPacket } = require('./bedrock-player-input.cjs');

class Client extends EventEmitter {
  sent = [];
  queue(packet, value) { this.sent.push({ packet, value }); }
}
const origin = { x: 8.5, y: 64, z: 10.5 };
const start = { runtime_entity_id: 123n, player_position: origin, dimension: 0,
  current_tick: 100n, movement_authority: 1 };
function initialized(client, bridge) {
  client.emit('start_game', start);
  client.emit('spawn');
  client.emit('level_chunk', { x: 0, z: 0, dimension: 0 });
  assert.equal(bridge.snapshot().state, 'observing');
}

test('world state mirrors only live packet data, without inventing blocks', () => {
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client).start();
  assert.equal(bridge.snapshot().state, 'awaiting_world');
  initialized(client, bridge);
  assert.deepEqual(bridge.snapshot().position, origin);
  assert.equal(bridge.snapshot().blocksDecoded, false);
  assert.equal(bridge.snapshot().loadedChunkHeaders, 1);
  client.emit('add_player', { runtime_entity_id: 999n, username: 'Friend',
    position: { x: 2, y: 64, z: 5 } });
  client.emit('move_player', { runtime_entity_id: 999n, position: { x: 3, y: 64, z: 6 } });
  assert.equal(bridge.snapshot().visiblePlayers, 1);
  client.emit('move_player', { runtime_entity_id: 123n,
    position: { x: 10, y: 64, z: 10 }, yaw: 90 });
  assert.equal(bridge.snapshot().position.x, 10);
  client.emit('correct_player_move_prediction', {
    position: { x: 9, y: 64, z: 10 }, tick: 105n
  });
  assert.equal(bridge.snapshot().correctionCount, 1);
  assert.equal(bridge.snapshot().position.x, 9);
  client.emit('remove_actor', { entity_id: 999n });
  assert.equal(bridge.snapshot().visiblePlayers, 0);
  client.emit('change_dimension', { dimension: 1 });
  assert.equal(bridge.snapshot().position, null);
  assert.equal(bridge.snapshot().loadedChunkHeaders, 0);
  bridge.stop();
  assert.equal(client.listenerCount('level_chunk'), 0);
  assert.equal(bridge.snapshot().state, 'closed');
});

test('chunk cache is bounded and ignores invalid/chunkless packets', () => {
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client).start();
  for (let i = 0; i < 300; i++) client.emit('level_chunk', { x: i, z: 0, dimension: 0 });
  client.emit('level_chunk', { x: Infinity, z: 0, dimension: 0 });
  client.emit('level_chunk', { x: 0, z: 1e9, dimension: 0 });
  assert.equal(bridge.snapshot().loadedChunkHeaders, 128);
  bridge.stop();
});

test('private single-command inbox handles status, stop and rejected commands', t => {
  const dir = mkdtempSync(join(tmpdir(), 'minepilot-gameplay-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const commandPath = join(dir, 'command.json'), receiptPath = join(dir, 'receipt.json');
  let stops = 0;
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, { commandPath, receiptPath,
    movement: { stop() { stops++; }, capability() { return 'unavailable'; } } }).start();
  const cmd = (requestId, action, rest = {}) => {
    writeFileSync(commandPath, JSON.stringify({
      version: 'minepilot.gameplay.v1', requestId, action, ...rest
    }));
    bridge.poll();
    assert.equal(existsSync(commandPath), false);
    return JSON.parse(readFileSync(receiptPath, 'utf8'));
  };
  assert.equal(cmd('cmd-1', 'status').status, 'ok');
  assert.equal(cmd('cmd-2', 'stop_movement').reason, 'movement_cancelled');
  assert.equal(stops, 1);
  assert.equal(cmd('cmd-3', 'probe_step', { confirmed: true, direction: 'forward' }).reason, 'movement_unavailable');
  assert.equal(cmd('cmd-4', 'mine').reason, 'invalid_command');
  writeFileSync(commandPath, '{"version":"minepilot.gameplay.v1","action":"status"');
  bridge.poll();
  assert.equal(JSON.parse(readFileSync(receiptPath, 'utf8')).reason, 'invalid_command');
  bridge.stop();
  assert.equal(stops, 2);
});

test('PlayerAuthInput builder is bounded and uses 1.26.60 ordinal input flags', () => {
  const frame = buildInputPacket(origin, 0, 101n, true);
  assert.equal(frame.position.z, origin.z + 0.065);
  assert.deepEqual(frame.input_data, [10]);
  assert.equal(frame.tick, 101n);
  assert.equal(frame.input_mode, 'touch');
  assert.equal(frame.raw_move_vector.z, 1);
  const stopped = buildInputPacket(frame.position, 0, 102n, false);
  assert.equal(stopped.position.z, frame.position.z);
  assert.deepEqual(stopped.input_data, []);
  assert.throws(() => buildInputPacket(origin, NaN, 101n, true), /Invalid/);
});

test('experimental diagnostic input requires opt-in, movement authority and explicit confirmation', async () => {
  const client = new Client();
  const disabled = new ExperimentalPlayerInput(client, false);
  const bridge = new BedrockGameplayBridge(client, { movement: disabled }).start();
  initialized(client, bridge);
  const probe = { version: 'minepilot.gameplay.v1', requestId: 'step1',
    action: 'probe_step', confirmed: true, direction: 'forward' };
  assert.equal(bridge.execute(probe).reason, 'movement_unavailable');
  assert.equal(client.sent.length, 0);
  bridge.stop();

  const enabled = new ExperimentalPlayerInput(client, true);
  const session = new BedrockGameplayBridge(client, { movement: enabled }).start();
  initialized(client, session);
  assert.equal(session.execute({ ...probe, confirmed: false }).reason, 'confirmation_required');
  assert.equal(session.execute(probe).status, 'accepted');
  await new Promise(resolve => setTimeout(resolve, 160));
  assert.ok(client.sent.length >= 1 && client.sent.length <= 6, 'bounded tick pulse');
  assert.ok(client.sent.every(s => s.packet === 'player_auth_input'));
  assert.ok(client.sent.every((s, i) => i === 0 || s.value.tick > client.sent[i - 1].value.tick));
  session.stop();
  const count = client.sent.length;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(client.sent.length, count);
});

test('pinned Bedrock 1.26.60 serializer accepts the experimental auth input shape', () => {
  const { createSerializer } = require('bedrock-protocol/src/transforms/serializer');
  const serializer = createSerializer('1.26.60');
  for (const moving of [true, false]) {
    const payload = buildInputPacket(origin, 0, 102n, moving);
    const buffer = serializer.createPacketBuffer({ name: 'player_auth_input', params: payload });
    assert.ok(Buffer.isBuffer(buffer) && buffer.length > 10);
  }
});

test('Layer 1 runs inspect -> wait -> stop -> probe through one live-client bridge', async () => {
  const { LayerOneController } = await import('./gameplay/layer-one.js');
  const client = new Client();
  let stopped = 0;
  const layerOne = new LayerOneController();
  const movement = {
    capability: () => 'experimental',
    probeStep: () => ({ status: 'accepted', reason: 'experimental_input_queued_not_verified' }),
    stop: () => { stopped++; }
  };
  const bridge = new BedrockGameplayBridge(client, { movement, layerOne }).start();
  initialized(client, bridge);
  client.emit('inventory_content', { window_id: 0, input: [
    { network_id: 1, count: 3 }, { network_id: 0, count: 0 }
  ] });
  assert.equal(bridge.snapshot().layerOne.inventory.known, true);
  assert.equal(bridge.snapshot().layerOne.inventory.occupiedSlots, 1);
  const command = (requestId, action, extra = {}) => bridge.execute({
    version: 'minepilot.gameplay.v1', requestId, action, ...extra
  });
  assert.equal(command('one', 'inspect').reason, 'inspection_complete');
  assert.equal(bridge.snapshot().layerOne.task.state, 'completed');
  assert.equal(command('two', 'wait').status, 'accepted');
  assert.equal(bridge.snapshot().layerOne.movementOwner, 'manual');
  assert.equal(command('three', 'probe_step', { confirmed: true, direction: 'forward' }).reason, 'wait_mode_active');
  assert.equal(command('four', 'stop_movement').status, 'ok');
  assert.equal(command('five', 'probe_step', { confirmed: true, direction: 'forward' }).status, 'accepted');
  assert.equal(bridge.snapshot().layerOne.task.state, 'awaiting_server_verification');
  client.emit('correct_player_move_prediction', { position: { x: 8.8, y: 64, z: 10.5 }, tick: 110n });
  assert.equal(bridge.snapshot().layerOne.task.state, 'completed');
  assert.equal(bridge.snapshot().layerOne.task.reason, 'server_position_changed');
  client.emit('update_attributes', { runtime_entity_id: 123n, attributes: [
    { name: 'minecraft:health', current: 4 }
  ] });
  assert.equal(bridge.snapshot().layerOne.safetyHold, true);
  assert.equal(command('six', 'probe_step', { confirmed: true, direction: 'forward' }).reason, 'critical_health');
  assert.ok(stopped > 0);
  bridge.stop();
  assert.equal(client.listenerCount('inventory_content'), 0);
  assert.equal(client.listenerCount('update_attributes'), 0);
});

test('Layer 2 plans named-player following, Stay and Return on the same client without sending packets', async () => {
  const { LayerOneController } = await import('./gameplay/layer-one.js');
  const { LayerTwoPlanner } = await import('./gameplay/layer-two.js');
  const client = new Client();
  const planner = new LayerTwoPlanner();
  const bridge = new BedrockGameplayBridge(client, {
    layerOne: new LayerOneController(), layerTwo: planner
  }).start();
  initialized(client, bridge);
  client.emit('player_list', { action_type: 'add', records: [{ uuid: 'uuid-fixture', username: 'BuilderFriend' }] });
  client.emit('add_player', {
    runtime_entity_id: 456n, uuid: 'uuid-fixture', position: { x: 15, y: 64, z: 10.5 }
  });
  const run = (requestId, action, extra = {}) => bridge.execute({
    version: 'minepilot.gameplay.v1', requestId, action, ...extra
  });
  assert.equal(bridge.snapshot().layerTwo.visiblePlayerNames[0], 'BuilderFriend');
  assert.equal(run('a', 'plan_follow', { playerName: 'BuilderFriend' }).reason, 'follow_plan_only');
  assert.equal(bridge.snapshot().layerTwo.preview.goal, 'follow');
  assert.equal(bridge.snapshot().layerTwo.preview.status, 'route_unverified');
  assert.equal(bridge.snapshot().layerTwo.preview.executed, false);
  assert.equal(client.sent.length, 0);
  client.emit('move_player', {
    runtime_entity_id: 456n, position: { x: 10, y: 64, z: 10.5 }
  });
  assert.equal(bridge.snapshot().layerTwo.preview.status, 'at_target');
  assert.equal(run('b', 'probe_step', { confirmed: true, direction: 'forward' }).reason,
    'planned_navigation_not_executable');
  assert.equal(run('c', 'stay').status, 'accepted');
  assert.equal(bridge.snapshot().layerTwo.preview.status, 'stay');
  assert.equal(run('d', 'set_home').reason, 'home_position_recorded');
  assert.equal(bridge.snapshot().layerTwo.homeKnown, true);
  client.emit('move_player', {
    runtime_entity_id: 123n, position: { x: 25, y: 64, z: 10.5 }
  });
  assert.equal(run('e', 'plan_return').reason, 'return_plan_only');
  assert.equal(bridge.snapshot().layerOne.movementOwner, null,
    'an accepted return plan releases the old Stay reservation');
  assert.equal(bridge.snapshot().layerTwo.preview.reason, 'direct_route_needs_collision_data');
  assert.equal(client.sent.length, 0);
  assert.equal(run('f', 'stop_movement').reason, 'movement_cancelled');
  assert.equal(bridge.snapshot().layerTwo.preview.status, 'idle');
  bridge.stop();
  assert.equal(client.listenerCount('player_list'), 0);
  assert.equal(client.listenerCount('mob_equipment'), 0);
});

test('Layer 2 equipment, target removal and health override are observational', async () => {
  const { LayerOneController } = await import('./gameplay/layer-one.js');
  const { LayerTwoPlanner } = await import('./gameplay/layer-two.js');
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, {
    layerOne: new LayerOneController(), layerTwo: new LayerTwoPlanner()
  }).start();
  initialized(client, bridge);
  client.emit('mob_equipment', {
    runtime_entity_id: 999n, slot: 1, item: { network_id: 40 }
  });
  assert.equal(bridge.snapshot().layerTwo.equipment.known, false);
  client.emit('mob_equipment', {
    runtime_entity_id: 123n, slot: 2, item: { network_id: 40 }
  });
  assert.equal(bridge.snapshot().layerTwo.equipment.known, true);
  assert.equal(bridge.snapshot().layerTwo.equipment.itemId, '40');
  client.emit('add_player', {
    runtime_entity_id: 456n, username: 'Friend', position: { x: 15, y: 64, z: 10.5 }
  });
  assert.equal(bridge.execute({
    version: 'minepilot.gameplay.v1', requestId: 'follow', action: 'plan_follow', playerName: 'Friend'
  }).status, 'accepted');
  client.emit('update_attributes', { runtime_entity_id: 123n,
    attributes: [{ name: 'minecraft:health', current: 3 }] });
  assert.equal(bridge.snapshot().layerTwo.preview.status, 'paused_by_safety');
  client.emit('remove_actor', { entity_id: 456n });
  assert.equal(bridge.snapshot().layerTwo.preview.status, 'paused_by_safety');
  client.emit('update_attributes', { runtime_entity_id: 123n,
    attributes: [{ name: 'minecraft:health', current: 20 }] });
  assert.equal(bridge.snapshot().layerTwo.preview.status, 'waiting_for_target');
  client.emit('change_dimension', { dimension: 1 });
  assert.equal(bridge.snapshot().layerTwo.preview.status, 'idle');
  assert.equal(bridge.snapshot().layerTwo.equipment.known, false);
  bridge.stop();
});

test('nested Bedrock PlayerRecords add/remove resolves names only for visible entities', async () => {
  const { LayerTwoPlanner } = await import('./gameplay/layer-two.js');
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, { layerTwo: new LayerTwoPlanner() }).start();
  initialized(client, bridge);
  client.emit('player_list', { records: { type: 'add', records: [
    { uuid: 'fixture-uuid-1', username: 'Friend#1234' }
  ] } });
  client.emit('add_player', {
    runtime_entity_id: 200n, uuid: 'fixture-uuid-1',
    position: { x: 14, y: 64, z: 11 }
  });
  assert.deepEqual(bridge.snapshot().layerTwo.visiblePlayerNames, ['Friend#1234']);
  assert.equal(bridge.execute({ version: 'minepilot.gameplay.v1', requestId: 'follow1',
    action: 'plan_follow', playerName: 'Friend#1234' }).status, 'accepted');
  client.emit('player_list', { records: { type: 'remove', records: [
    { uuid: 'fixture-uuid-1' }
  ] } });
  client.emit('remove_actor', { entity_id: 200n });
  assert.equal(bridge.snapshot().layerTwo.preview.status, 'waiting_for_target');
  bridge.stop();
});
