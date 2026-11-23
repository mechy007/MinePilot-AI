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
  // Strip the two intentional initial loading-screen completion writes;
  // later tests assert zero unsolicited *gameplay* input packets.
  client.sent.length = 0;
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

test('Layer 3 same-client resource planning, pickup receipts and inventory observations issue zero gameplay packets', async () => {
  const { LayerOneController } = await import('./gameplay/layer-one.js');
  const { LayerTwoPlanner } = await import('./gameplay/layer-two.js');
  const { LayerThreePlanner } = await import('./gameplay/layer-three.js');
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, {
    layerOne: new LayerOneController(),
    layerTwo: new LayerTwoPlanner(),
    layerThree: new LayerThreePlanner()
  }).start();
  initialized(client, bridge);
  const execute = (requestId, action, more = {}) => bridge.execute({
    version: 'minepilot.gameplay.v1', requestId, action, ...more
  });
  client.emit('item_registry', { itemstates: [
    { name: 'minecraft:oak_log', runtime_id: 5 },
    { name: 'minecraft:stone', runtime_id: 9 }
  ] });
  client.emit('inventory_content', { window_id: 'inventory', input: [
    { network_id: 5, count: 2 }, { network_id: 0, count: 0 }
  ] });
  client.emit('add_item_entity', {
    runtime_entity_id: 1000n, item: { network_id: 5, count: 2 },
    position: { x: 16, y: 64, z: 10.5 }
  });
  const first = bridge.snapshot().layerThree;
  assert.equal(first.registeredItems, 2);
  assert.equal(first.observedDrops, 1);
  assert.deepEqual(first.nearbyItemNames, ['minecraft:oak_log']);
  assert.equal(execute('collect', 'plan_collect', {
    itemName: 'minecraft:oak_log', count: 2
  }).reason, 'collect_plan_only');
  const planned = bridge.snapshot().layerThree.route;
  assert.equal(planned.status, 'route_unverified');
  assert.equal(planned.executed, false);
  assert.equal(client.sent.length, 0);
  assert.equal(execute('probe', 'probe_step', {
    confirmed: true, direction: 'forward'
  }).reason, 'resource_goal_not_executable');
  assert.equal(execute('wait-now', 'wait').status, 'accepted');
  assert.equal(bridge.snapshot().layerThree.route.status, 'idle',
    'Wait cancels resource goals before any input');
  assert.equal(execute('collect-again', 'plan_collect', {
    itemName: 'minecraft:oak_log', count: 2
  }).status, 'accepted');
  client.emit('take_item_entity', { runtime_entity_id: 1000n, target: 123n });
  client.emit('inventory_content', { window_id: 'inventory', input: [
    { network_id: 5, count: 4 }
  ] });
  assert.equal(bridge.snapshot().layerThree.route.status, 'observed_inventory_increase');
  assert.equal(bridge.snapshot().layerThree.route.observed, 2);
  assert.equal(bridge.snapshot().layerThree.route.executed, false);
  assert.equal(client.sent.length, 0);
  assert.equal(execute('stop', 'stop_movement').reason, 'movement_cancelled');
  assert.equal(bridge.snapshot().layerThree.route.status, 'idle');
  bridge.stop();
  for (const event of ['item_registry', 'add_item_entity', 'take_item_entity', 'update_block']) {
    assert.equal(client.listenerCount(event), 0);
  }
});

test('Layer 3 block updates do not imply mining, and dimension resets resource targets', async () => {
  const { LayerThreePlanner } = await import('./gameplay/layer-three.js');
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, { layerThree: new LayerThreePlanner() }).start();
  client.emit('start_game', {
    runtime_entity_id: 123n, player_position: { x: 0, y: 64, z: 0 },
    dimension: 'overworld', current_tick: 100n, movement_authority: 'server'
  });
  client.emit('spawn');
  client.emit('level_chunk', { x: 0, z: 0, dimension: 0 });
  assert.equal(bridge.snapshot().dimension, 0);
  assert.equal(bridge.snapshot().movementAuthority, 1);
  client.emit('update_block', { position: { x: 8, y: 64, z: 0 }, block_runtime_id: 175,
    flags: 2, layer: 0 });
  assert.equal(bridge.snapshot().layerThree.observedBlockUpdates, 1);
  const inspected = bridge.execute({
    version: 'minepilot.gameplay.v1', requestId: 'inspect-block', action: 'inspect_block'
  });
  assert.equal(inspected.reason, 'block_observation_only');
  assert.equal(bridge.snapshot().layerThree.route.status, 'route_unverified');
  assert.equal(bridge.snapshot().layerThree.route.executed, false);
  assert.deepEqual(client.sent.map(s => s.packet),
    ['serverbound_loading_screen', 'serverbound_loading_screen'],
    'spawn initialization packets do not imply gameplay or mining');
  client.emit('change_dimension', { dimension: 1 });
  assert.equal(bridge.snapshot().layerThree.observedBlockUpdates, 0);
  assert.equal(bridge.snapshot().layerThree.route.status, 'idle');
  bridge.stop();
});

test('pinned Bedrock SDK serializes break intent fixtures without executing them', () => {
  // Future mining must choose the host-negotiated authority and confirm updates.
  // These are codec-only fixtures: no network client or player_action is sent.
  const { createSerializer } = require('bedrock-protocol/src/transforms/serializer');
  const serializer = createSerializer('1.26.60');
  const position = { x: 8, y: 64, z: 10 };
  for (const action of ['start_break', 'abort_break']) {
    const legacy = serializer.createPacketBuffer({
      name: 'player_action',
      params: { runtime_entity_id: 123n, action, position, result_position: position, face: 1 }
    });
    assert.ok(Buffer.isBuffer(legacy) && legacy.length > 10);
    const auth = buildInputPacket(origin, 0, 103n, false);
    auth.input_data = [35]; // InputData.block_action (protocol 2225)
    auth.block_action = [{ action, position, face: 1 }];
    const encoded = serializer.createPacketBuffer({
      name: 'player_auth_input', params: auth
    });
    assert.ok(Buffer.isBuffer(encoded) && encoded.length > 10);
  }
});


test('Layer 4 interrupts existing follow plan on low air and only suggests food from verified inventory', async () => {
  const { LayerOneController } = await import('./gameplay/layer-one.js');
  const { LayerTwoPlanner } = await import('./gameplay/layer-two.js');
  const { LayerThreePlanner } = await import('./gameplay/layer-three.js');
  const { LayerFourSupervisor } = await import('./gameplay/layer-four.js');
  const client = new Client();
  let stops = 0;
  const bridge = new BedrockGameplayBridge(client, {
    layerOne: new LayerOneController(), layerTwo: new LayerTwoPlanner(),
    layerThree: new LayerThreePlanner(), layerFour: new LayerFourSupervisor(),
    movement: { capability: () => 'unavailable', stop: () => { stops++; } }
  }).start();
  initialized(client, bridge);
  client.emit('add_player', {
    runtime_entity_id: 456n, username: 'Friend',
    position: { x: 20, y: 64, z: 10.5 }
  });
  const cmd = (id, action, rest = {}) => bridge.execute({
    version: 'minepilot.gameplay.v1', requestId: id, action, ...rest
  });
  assert.equal(cmd('follow', 'plan_follow', { playerName: 'Friend' }).status, 'accepted');
  client.emit('item_registry', { itemstates: [
    { runtime_id: 11, name: 'minecraft:bread' },
    { runtime_id: 12, name: 'minecraft:stone' }
  ] });
  client.emit('inventory_content', { window_id: 'inventory', input: [
    { network_id: 11, count: 3 }, { network_id: 12, count: 64 }
  ] });
  client.emit('set_time', { time: 14000 });
  client.emit('update_attributes', { runtime_entity_id: 999n,
    attributes: [{ name: 'minecraft:player.air_supply', current: 0 }] });
  assert.equal(bridge.snapshot().layerFour.level, 'caution', 'night advisory may be present');
  assert.equal(bridge.snapshot().layerFour.taskStatus, 'running', 'other entities cannot interrupt bot');
  client.emit('update_attributes', { runtime_entity_id: 123n,
    attributes: [
      { name: 'minecraft:health', current: 20 },
      { name: 'minecraft:player.hunger', current: 4 },
      { name: 'minecraft:player.air_supply', current: 2 }
    ] });
  assert.equal(bridge.snapshot().layerFour.level, 'critical');
  assert.equal(bridge.snapshot().layerFour.reason, 'low_air_supply');
  assert.equal(cmd('air-probe', 'probe_step', { confirmed: true, direction: 'forward' }).reason,
    'survival_hold');
  assert.equal(bridge.snapshot().layerFour.taskStatus, 'paused');
  assert.equal(bridge.snapshot().layerTwo.preview.status, 'paused_by_safety');
  assert.ok(stops >= 2);
  assert.equal(cmd('food', 'plan_food').reason, 'food_use_requires_verified_item_interaction');
  assert.equal(bridge.snapshot().layerFour.foodPlan.item, 'minecraft:bread');
  assert.equal(bridge.snapshot().layerFour.foodPlan.status, 'planned_not_executed');
  assert.equal(bridge.snapshot().layerFour.executed, false);
  client.emit('update_attributes', { runtime_entity_id: 123n,
    attributes: [{ name: 'minecraft:player.air_supply', current: 20 }] });
  assert.equal(bridge.snapshot().layerFour.taskStatus, 'ready_to_replan');
  assert.equal(bridge.snapshot().layerTwo.preview.status, 'route_unverified');
  assert.equal(client.sent.length, 0, 'no eating, mining or movement packet was emitted');
  bridge.stop();
  assert.equal(client.listenerCount('set_time'), 0);
});


test('Layer 5 plans a shelter and crafting BOM from live inventory without emitting block or crafting actions', async () => {
  const { LayerOneController } = await import('./gameplay/layer-one.js');
  const { LayerTwoPlanner } = await import('./gameplay/layer-two.js');
  const { LayerThreePlanner } = await import('./gameplay/layer-three.js');
  const { LayerFourSupervisor } = await import('./gameplay/layer-four.js');
  const { LayerFivePlanner } = await import('./gameplay/layer-five.js');
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, {
    layerOne: new LayerOneController(),
    layerTwo: new LayerTwoPlanner(),
    layerThree: new LayerThreePlanner(),
    layerFour: new LayerFourSupervisor(),
    layerFive: new LayerFivePlanner()
  }).start();
  initialized(client, bridge);
  const cmd = (id, action, more = {}) => bridge.execute({
    version: 'minepilot.gameplay.v1', requestId: id, action, ...more
  });
  client.emit('item_registry', { itemstates: [
    { runtime_id: 11, name: 'minecraft:oak_planks' },
    { runtime_id: 12, name: 'minecraft:oak_log' }
  ] });
  client.emit('inventory_content', { window_id: 'inventory', input: [
    { network_id: 11, count: 8 }, { network_id: 12, count: 4 }
  ] });
  assert.equal(cmd('shelter', 'plan_shelter', { material: 'minecraft:oak_planks' }).status, 'accepted');
  let build = bridge.snapshot().layerFive;
  assert.equal(build.kind, 'shelter');
  assert.equal(build.state, 'materials_missing');
  assert.equal(build.required, 23);
  assert.equal(build.onHand, 8);
  assert.equal(build.missing, 15);
  assert.equal(build.suggestedLogs, 4);
  assert.equal(build.executed, false);
  client.emit('update_block', { position: { x: 8, y: 64, z: 9 }, layer: 0, block_runtime_id: 23 });
  assert.equal(bridge.snapshot().layerFive.observedNearbyBlockUpdates, 1);
  assert.equal(bridge.snapshot().layerFive.executed, false);
  assert.equal(cmd('probe', 'probe_step', { direction: 'forward', confirmed: true }).reason,
    'building_plan_not_executable');

  client.emit('update_attributes', { runtime_entity_id: 123n,
    attributes: [{ name: 'minecraft:health', current: 3 }] });
  assert.equal(bridge.snapshot().layerFive.state, 'paused_by_safety');
  assert.equal(cmd('blocked', 'plan_craft_planks', { material: 'minecraft:oak_planks', count: 12 }).reason,
    'survival_hold');
  client.emit('update_attributes', { runtime_entity_id: 123n,
    attributes: [{ name: 'minecraft:health', current: 20 }] });
  assert.equal(cmd('craft', 'plan_craft_planks', { material: 'minecraft:oak_planks', count: 12 }).status,
    'accepted');
  build = bridge.snapshot().layerFive;
  assert.equal(build.kind, 'craft_planks');
  assert.equal(build.missing, 4);
  assert.equal(build.suggestedLogs, 1);
  assert.equal(build.executed, false);
  assert.equal(client.sent.length, 0, 'no minecraft player action, craft or inventory packet emitted');
  assert.equal(cmd('stop', 'stop_movement').status, 'ok');
  assert.equal(bridge.snapshot().layerFive.kind, 'none');
  bridge.stop();
  assert.equal(client.listenerCount('item_registry'), 0);
  assert.equal(client.listenerCount('update_block'), 0);
});


test('Layer 6 previews farming/storage, observes separate container and blocks without game actions', async () => {
  const { LayerOneController } = await import('./gameplay/layer-one.js');
  const { LayerThreePlanner } = await import('./gameplay/layer-three.js');
  const { LayerFourSupervisor } = await import('./gameplay/layer-four.js');
  const { LayerSixWorkflow } = await import('./gameplay/layer-six.js');
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, {
    layerOne: new LayerOneController(), layerThree: new LayerThreePlanner(),
    layerFour: new LayerFourSupervisor(), layerSix: new LayerSixWorkflow()
  }).start();
  initialized(client, bridge);
  const cmd = (id, action, more = {}) =>
    bridge.execute({ version: 'minepilot.gameplay.v1', requestId: id, action, ...more });
  client.emit('inventory_content', { window_id: 7, input: [
    { count: 3, network_id: 1 }, { count: 0, network_id: 0 }
  ] });
  assert.equal(bridge.snapshot().layerSix.containersObserved, 1);
  assert.equal(cmd('work-1', 'plan_workflow', { workflowKind: 'farm_preview' }).status,'accepted');
  client.emit('update_block', { position: { x: 8, y: 64, z: 10 }, layer: 0,
    block_runtime_id: 22 });
  assert.equal(bridge.snapshot().layerSix.recentBlockUpdates,1);
  assert.equal(cmd('work-2', 'review_checkpoint', { checkpoint:'observe' }).status,'ok');
  assert.equal(cmd('work-3', 'review_checkpoint', { checkpoint:'inventory' }).status,'ok');
  assert.equal(cmd('work-4', 'review_checkpoint', { checkpoint:'terrain' }).status,'blocked');
  assert.equal(bridge.snapshot().layerSix.nextStep, 'review_terrain');
  assert.equal(bridge.snapshot().layerSix.executed,false);
  assert.equal(cmd('work-5', 'probe_step', { confirmed:true, direction:'forward' }).reason,
    'workflow_not_executable');
  assert.equal(client.sent.length,0);
  assert.equal(cmd('work-6', 'stop_movement').status,'ok');
  assert.equal(bridge.snapshot().layerSix.kind,'none');
  assert.equal(cmd('work-7', 'plan_workflow', { workflowKind:'storage_preview' }).status,'accepted');
  client.emit('change_dimension', { dimension:1 });
  assert.equal(bridge.snapshot().layerSix.kind,'none');
  bridge.stop();
  assert.equal(client.listenerCount('inventory_content'),0);
});


test('Layer 7 optional advisor sees same-client survival and workflow state but never executes actions', async () => {
  const { LayerOneController } = await import('./gameplay/layer-one.js');
  const { LayerFourSupervisor } = await import('./gameplay/layer-four.js');
  const { LayerSevenAdvisor } = await import('./gameplay/layer-seven.js');
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, {
    layerOne: new LayerOneController(), layerFour: new LayerFourSupervisor(),
    layerSeven: new LayerSevenAdvisor()
  }).start();
  initialized(client, bridge);
  const cmd = (requestId, action, more = {}) => bridge.execute({
    version: 'minepilot.gameplay.v1', requestId, action, ...more
  });
  assert.equal(bridge.snapshot().layerSeven.mode, 'off');
  assert.equal(cmd('suggest', 'advisor_mode', { mode:'suggestions' }).reason,'suggestions_only');
  assert.equal(bridge.snapshot().layerSeven.recommendation.action,'inspect');
  client.emit('update_attributes', { runtime_entity_id:123n, attributes: [
    { name:'minecraft:health',current:3 },
    { name:'minecraft:player.hunger',current:4 }
  ] });
  assert.equal(bridge.snapshot().layerSeven.recommendation.action,'stop');
  assert.equal(bridge.snapshot().layerSeven.recommendation.executed,false);
  assert.equal(cmd('review','advisor_review').status,'ok');
  assert.equal(bridge.snapshot().layerSeven.journalSize,1);
  assert.equal(client.sent.length,0);
  assert.equal(cmd('disable','advisor_mode',{mode:'off'}).status,'accepted');
  assert.equal(bridge.snapshot().layerSeven.journalSize,0);
  assert.equal(bridge.snapshot().layerSeven.mode,'off');
  bridge.stop();
});


test('Layer 8 enforces fresh world observations and never claims beta or autonomous gameplay', async () => {
  const { LayerEightReadiness } = await import('./gameplay/layer-eight.js');
  const { LayerSixWorkflow } = await import('./gameplay/layer-six.js');
  let now = 1000;
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, {
    layerEight: new LayerEightReadiness(), layerSix: new LayerSixWorkflow(()=>now),
    clock: () => now
  }).start();
  initialized(client, bridge);
  const cmd = (id, action, more = {}) => bridge.execute({
    version: 'minepilot.gameplay.v1', requestId: id, action, ...more
  });
  assert.equal(bridge.snapshot().layerEight.stage,'planning_preview');
  assert.equal(bridge.snapshot().layerEight.releaseReady,false);
  assert.equal(bridge.snapshot().layerEight.liveWalkVerified,false);
  assert.equal(cmd('farm1','plan_workflow',{workflowKind:'farm_preview'}).status,'accepted');
  now += 30001;
  assert.equal(bridge.snapshot().layerEight.commandReason,'server_position_stale');
  assert.equal(cmd('farm2','plan_workflow',{workflowKind:'storage_preview'}).reason,'server_position_stale');
  assert.equal(cmd('stop','stop_movement').status,'ok','Stop always works with stale position');
  client.emit('move_player', { runtime_entity_id:123n, position:{x:9,y:64,z:10.5} });
  assert.equal(bridge.snapshot().layerEight.commandEligible,true);
  assert.equal(cmd('farm3','plan_workflow',{workflowKind:'storage_preview'}).status,'accepted');
  assert.equal(bridge.snapshot().layerEight.autonomousGameplayReady,false);
  assert.equal(client.sent.length,0);
  bridge.stop();
  assert.equal(bridge.snapshot().layerEight.stage,'disconnected');
});


test('motion diagnostic uses bounded 20 Hz frame sequence and one neutral stop', () => {
  const client = new Client();
  let now=1000, pulse;
  const movement = new ExperimentalPlayerInput(client, true, {
    clock: () => now, setInterval: callback => { pulse=callback; return 123; },
    clearInterval: () => {}
  });
  const bridge = new BedrockGameplayBridge(client, { movement, clock: () => now }).start();
  initialized(client, bridge);
  const cmd = (requestId, extra={}) => bridge.execute({
    version:'minepilot.gameplay.v1', requestId, action:'motion_diagnostic', ...extra
  });
  assert.equal(cmd('without-confirm',{ mode:'forward',ticks:6 }).reason,'confirmation_required');
  assert.equal(cmd('bad-frames',{ mode:'forward',ticks:21,confirmed:true }).reason,'unsupported_diagnostic');
  assert.equal(cmd('start',{ mode:'forward',ticks:6,confirmed:true }).status,'accepted');
  assert.equal(cmd('busy',{ mode:'forward',ticks:6,confirmed:true }).reason,'movement_busy');
  for(let i=0;i<6;i++){ now+=50;pulse(); }
  assert.equal(movement.snapshot().framesSent,6);
  assert.equal(client.sent.length,6);
  now+=50;pulse();
  assert.equal(client.sent.length,7,'one neutral end frame');
  assert.equal(client.sent.at(-1).value.raw_move_vector.z,0);
  assert.equal(movement.snapshot().active,false);
  assert.equal(movement.snapshot().stoppedReason,'bounded_sequence_complete');
  assert.ok(client.sent.every(x=>x.packet==='player_auth_input'));
  assert.ok(client.sent.every((x,i)=>i===0||x.value.tick>client.sent[i-1].value.tick));
  assert.equal(movement.snapshot().movementVerified,false);
  bridge.stop();
});

test('turn diagnostics change yaw without claiming movement and are serializer-compatible', () => {
  const client = new Client();
  let now=2000, pulse;
  const movement = new ExperimentalPlayerInput(client,true,{
    clock:()=>now,setInterval:cb=>{pulse=cb;return 1},clearInterval:()=>{}
  });
  const bridge = new BedrockGameplayBridge(client,{movement,clock:()=>now}).start();
  initialized(client,bridge);
  for(const [mode,sign] of [['turn_left',-1],['turn_right',1]]) {
    const result=bridge.execute({version:'minepilot.gameplay.v1',
      requestId:mode,action:'motion_diagnostic',mode,ticks:2,confirmed:true});
    assert.equal(result.status,'accepted');
    now+=50;pulse();
    const first=client.sent.at(-1).value;
    assert.equal(first.raw_move_vector.z,0);
    assert.deepEqual(first.position,origin);
    assert.equal(first.yaw,sign===-1?355:5);
    now+=50;pulse();
    movement.stop();
  }
  const {createSerializer}=require('bedrock-protocol/src/transforms/serializer');
  const serializer=createSerializer('1.26.60');
  for(const frame of client.sent) {
    const encoded=serializer.createPacketBuffer({name:'player_auth_input',params:frame.value});
    assert.ok(encoded.length>10);
  }
  bridge.stop();
});

test('server correction input can halt excessive prediction drift and reset on disconnect', () => {
  const client = new Client();
  let now=1000,pulse;
  const movement = new ExperimentalPlayerInput(client,true,{
    clock:()=>now,setInterval:cb=>{pulse=cb;return 1},clearInterval:()=>{}
  });
  const bridge = new BedrockGameplayBridge(client,{movement,clock:()=>now}).start();
  initialized(client,bridge);
  assert.equal(bridge.execute({version:'minepilot.gameplay.v1',requestId:'start',
    action:'motion_diagnostic',mode:'forward',ticks:20,confirmed:true}).status,'accepted');
  now+=50;pulse();
  client.emit('correct_player_move_prediction',{position:{x:100,y:64,z:100},tick:104n});
  assert.equal(movement.snapshot().corrections,1);
  now+=50;pulse();
  client.emit('correct_player_move_prediction',{position:{x:200,y:64,z:200},tick:110n});
  assert.equal(movement.snapshot().stoppedReason,'prediction_diverged');
  assert.equal(movement.snapshot().active,false);
  assert.equal(movement.snapshot().movementVerified,false);
  assert.ok(client.sent.length<=4);
  bridge.stop();
  assert.equal(client.listenerCount('correct_player_move_prediction'),0);
});

test('normal Stop and critical survival continue to override experimental diagnostics', () => {
  const client=new Client();
  let pulse,now=1000;
  const movement=new ExperimentalPlayerInput(client,true,{
    clock:()=>now,setInterval:cb=>{pulse=cb;return 1},clearInterval:()=>{}
  });
  const bridge=new BedrockGameplayBridge(client,{movement,clock:()=>now}).start();
  initialized(client,bridge);
  const cmd=(id,action,more={})=>bridge.execute({
    version:'minepilot.gameplay.v1',requestId:id,action,...more
  });
  assert.equal(cmd('one','motion_diagnostic',{confirmed:true,mode:'forward',ticks:6}).status,'accepted');
  now+=50;pulse();
  assert.equal(cmd('stop','stop_movement').status,'ok');
  assert.equal(movement.snapshot().active,false);
  assert.equal(client.sent.at(-1).value.input_data.length,0);
  const count=client.sent.length;
  now+=50;pulse();
  assert.equal(client.sent.length,count);
  bridge.stop();
});

test('motion diagnostics require opt-in and server-authenticated movement authority', () => {
  const client=new Client();
  const movement=new ExperimentalPlayerInput(client,false);
  const bridge=new BedrockGameplayBridge(client,{movement}).start();
  initialized(client,bridge);
  assert.equal(bridge.execute({version:'minepilot.gameplay.v1',requestId:'x',
    action:'motion_diagnostic',mode:'forward',ticks:6,confirmed:true}).reason,'movement_unavailable');
  assert.equal(client.sent.length,0);
  bridge.stop();
});


test('pinned Bedrock authority packet activates diagnostics after StartGame without movement_authority', () => {
  const client=new Client();
  let now=1000,pulse;
  const movement=new ExperimentalPlayerInput(client,true,{
    clock:()=>now,setInterval:cb=>{pulse=cb;return 1;},clearInterval:()=>{}
  });
  const bridge=new BedrockGameplayBridge(client,{movement,clock:()=>now}).start();
  const actualStart={...start};
  delete actualStart.movement_authority;
  actualStart.rotation={x:7,z:90};
  client.emit('start_game',actualStart);
  client.emit('spawn');
  client.emit('level_chunk',{x:0,z:0,dimension:0});
  assert.equal(bridge.yaw,90);
  assert.equal(bridge.pitch,7);
  assert.equal(bridge.movementAuthority,null);
  assert.equal(movement.capability(bridge),'unavailable');
  client.emit('set_movement_authority',{movement_authority:'server'});
  assert.equal(bridge.movementAuthority,1);
  assert.equal(movement.capability(bridge),'experimental');
  const cmd={version:'minepilot.gameplay.v1',requestId:'authority',
    action:'motion_diagnostic',confirmed:true,mode:'forward',ticks:6};
  assert.equal(bridge.execute(cmd).status,'accepted');
  now+=50;pulse();
  assert.ok(client.sent.at(-1).value.position.x<origin.x);
  client.emit('set_movement_authority',{movement_authority:'client'});
  assert.equal(movement.snapshot().active,false);
  assert.equal(movement.snapshot().stoppedReason,'movement_authority_changed');
  assert.equal(movement.capability(bridge),'unavailable');
  const written=client.sent.length;
  now+=50;pulse();
  assert.equal(client.sent.length,written);
  bridge.stop();
  assert.equal(client.listenerCount('set_movement_authority'),0);
});

test('server correction packet rotation updates yaw in the authenticated session',()=>{
  const client=new Client();
  const bridge=new BedrockGameplayBridge(client).start();
  initialized(client,bridge);
  client.emit('correct_player_move_prediction',{
    position:origin,rotation:{x:12,z:135},tick:105n
  });
  assert.equal(bridge.pitch,12);
  assert.equal(bridge.yaw,135);
  bridge.stop();
});


test('Bedrock input ticks stay monotonic across separate diagnostic commands and restart only on fresh StartGame', () => {
  const client=new Client();
  let now=1000,pulse;
  const movement=new ExperimentalPlayerInput(client,true,{
    clock:()=>now,setInterval:cb=>{pulse=cb;return 1},clearInterval:()=>{}
  });
  const bridge=new BedrockGameplayBridge(client,{movement,clock:()=>now}).start();
  initialized(client,bridge);
  for(const id of ['first','second']){
    assert.equal(bridge.execute({version:'minepilot.gameplay.v1',requestId:id,
      action:'motion_diagnostic',mode:'forward',ticks:1,confirmed:true}).status,'accepted');
    now+=50;pulse();now+=50;pulse();
  }
  assert.deepEqual(client.sent.map(x=>x.value.tick),[101n,102n,103n,104n]);
  client.emit('start_game',{...start,current_tick:500n});
  client.emit('spawn');
  client.emit('level_chunk',{x:0,z:0,dimension:0});
  assert.equal(bridge.execute({version:'minepilot.gameplay.v1',requestId:'fresh',
    action:'motion_diagnostic',mode:'forward',ticks:1,confirmed:true}).status,'accepted');
  now+=50;pulse();now+=50;pulse();
  assert.deepEqual(client.sent.slice(-2).map(x=>x.value.tick),[501n,502n]);
  bridge.stop();
});


test('spawn completes loading gate exactly once and does not claim combat/physics readiness', () => {
  const client=new Client();
  const bridge=new BedrockGameplayBridge(client).start();
  client.emit('start_game',{...start,player_gamemode:'fallback',world_gamemode:'survival',difficulty:2});
  client.emit('respawn',{runtime_entity_id:123n,state:1,
    position:{x:8.5,y:65,z:10.5}});
  assert.equal(client.sent.length,1);
  assert.equal(client.sent[0].packet,'respawn');
  assert.equal(client.sent[0].value.state,2);
  assert.equal(bridge.snapshot().position.y,65);
  client.emit('spawn');
  client.emit('level_chunk',{x:0,z:0,dimension:0});
  assert.deepEqual(client.sent.slice(-2).map(x=>x.packet),
    ['serverbound_loading_screen','serverbound_loading_screen']);
  assert.deepEqual(client.sent.slice(-2).map(x=>x.value.type),[1,2]);
  client.emit('spawn');
  assert.equal(client.sent.length,3,'duplicate spawn does not resend loading');
  const snap=bridge.snapshot();
  assert.equal(snap.serverGameMode,'survival');
  assert.equal(snap.difficulty,2);
  assert.equal(snap.spawnHandshake.respawnAcknowledged,1);
  assert.equal(snap.spawnHandshake.loadingPacketsSent,2);
  assert.equal(snap.spawnHandshake.loadingCompleted,true);
  assert.equal(snap.blocksDecoded,false);
  bridge.stop();
  assert.equal(client.listenerCount('respawn'),0);
});

test('player game modes are observed but never altered, and other players cannot spoof local mode',()=>{
  const client=new Client();
  const bridge=new BedrockGameplayBridge(client).start();
  client.emit('start_game',{...start,player_gamemode:'creative',world_gamemode:'survival'});
  client.emit('spawn');
  assert.equal(bridge.snapshot().serverGameMode,'creative');
  client.emit('update_player_game_type',{gamemode:'survival',player_unique_id:999n});
  assert.equal(bridge.snapshot().serverGameMode,'creative');
  client.emit('set_player_game_type',{gamemode:'survival'});
  assert.equal(bridge.snapshot().serverGameMode,'survival');
  client.emit('change_dimension',{dimension:1});
  assert.equal(bridge.snapshot().spawnHandshake.loadingCompleted,false);
  client.emit('spawn');
  assert.equal(bridge.snapshot().spawnHandshake.loadingPacketsSent,2);
  bridge.stop();
});

test('spawn frame only writes handshake packets; no automatic walking/mining occurs',()=>{
  const client=new Client();
  const bridge=new BedrockGameplayBridge(client).start();
  client.emit('start_game',start);
  client.emit('spawn');
  assert.deepEqual(client.sent.map(x=>x.packet),
    ['serverbound_loading_screen','serverbound_loading_screen']);
  assert.equal(client.sent.some(x=>x.packet==='player_auth_input'),false);
  bridge.stop();
});


test('pinned Bedrock 1.26.60 serializer accepts spawn completion and respawn acknowledgement frames',()=>{
  const {createSerializer}=require('bedrock-protocol/src/transforms/serializer');
  const codec=createSerializer('1.26.60');
  const frames=[
    {name:'respawn',params:{position:origin,state:2,runtime_entity_id:123n}},
    {name:'serverbound_loading_screen',params:{type:1}},
    {name:'serverbound_loading_screen',params:{type:2}}
  ];
  for(const frame of frames) {
    const encoded=codec.createPacketBuffer(frame);
    assert.ok(Buffer.isBuffer(encoded) && encoded.length>0,frame.name+' serializes');
  }
});
