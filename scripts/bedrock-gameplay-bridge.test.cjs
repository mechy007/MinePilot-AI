'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { test } = require('node:test');
const { BedrockGameplayBridge } = require('./bedrock-gameplay-bridge.cjs');
const { learningEngineFor, odysseyCapabilityStates } = require('./bedrock-skill-manifest.cjs');
const { ExperimentalPlayerInput, buildInputPacket } = require('./bedrock-player-input.cjs');
const { BedrockTerrainCache } = require('./bedrock-terrain-cache.cjs');

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
  assert.equal(bridge.movementAuthority,1,
    'modern Bedrock must not depend on deprecated authority packet');
  assert.equal(bridge.movementAuthoritySource,'protocol_1_26_default');
  assert.equal(movement.capability(bridge),'experimental');
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


test('Bedrock Dedicated Server zero runtime-id respawn packets are accepted for the local player', () => {
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client).start();
  initialized(client, bridge);

  client.emit('update_attributes', {
    runtime_entity_id: 123n,
    attributes: [{ name: 'minecraft:health', current: 0 }]
  });
  assert.equal(bridge.snapshot().respawnRecovery.state, 'dead_waiting_for_server');

  // BDS has been observed sending zero in the Respawn packet runtime-ID field.
  client.emit('respawn', {
    runtime_entity_id: 0n, state: 0, position: origin
  });
  assert.deepEqual(client.sent.map(packet => packet.packet), ['respawn']);
  assert.equal(client.sent[0].value.state, 2);

  client.emit('respawn', {
    runtime_entity_id: '0', state: 1, position: { x: 12.5, y: 70, z: 8.5 }
  });
  assert.deepEqual(client.sent.map(packet => packet.packet), ['respawn', 'player_action']);
  assert.equal(client.sent[1].value.action, 'respawn');
  assert.equal(bridge.snapshot().respawnRecovery.state, 'respawn_action_sent');

  client.emit('update_attributes', {
    runtime_entity_id: 123n,
    attributes: [{ name: 'minecraft:health', current: 20 }]
  });
  assert.equal(bridge.snapshot().respawnRecovery.state, 'alive');
  assert.equal(bridge.snapshot().respawnRecovery.recovered, 1);
  assert.deepEqual(bridge.snapshot().position, { x: 12.5, y: 70, z: 8.5 });
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


test('addon-derived follow priority is wired to same Xbox world without automatic movement', async()=>{
  const { LayerTwoPlanner } = await import('./gameplay/layer-two.js');
  const { BedrockMotionArbiter } = await import('./gameplay/addon-navigation.js');
  const client=new Client();
  const bridge=new BedrockGameplayBridge(client,{
    layerTwo:new LayerTwoPlanner(),
    addonNavigation:new BedrockMotionArbiter()
  }).start();
  initialized(client,bridge);
  client.emit('add_player',{
    runtime_entity_id:456n,username:'BuilderFriend',
    position:{x:14,y:64,z:10.5}
  });
  const follow=bridge.execute({version:'minepilot.gameplay.v1',
    requestId:'follow-addon',action:'plan_follow',playerName:'BuilderFriend'});
  assert.equal(follow.status,'accepted');
  assert.equal(bridge.snapshot().addonNavigation.owner,null,
    'unknown terrain may not claim a physical Follow route');
  assert.equal(bridge.snapshot().addonNavigation.state,'idle');
  assert.equal(bridge.snapshot().navigationRoute,undefined);
  assert.equal(bridge.snapshot().addonNavigation.executed,false);
  assert.equal(client.sent.some(s=>s.packet==='player_auth_input'),false);
  assert.equal(bridge.execute({version:'minepilot.gameplay.v1',requestId:'addon-stop',
    action:'stop_movement'}).status,'ok');
  assert.equal(bridge.snapshot().addonNavigation.owner,null);
  bridge.stop();
});


test('neutral presence sends continuous 20Hz frames without moving when experimental locomotion is disabled',()=>{
  const client=new Client();
  let now=1000,intervals=new Map(),counter=0;
  const movement=new ExperimentalPlayerInput(client,false,{
    presenceEnabled:true,clock:()=>now,
    setInterval:callback=>{const id=++counter;intervals.set(id,callback);return id;},
    clearInterval:id=>intervals.delete(id)
  });
  const bridge=new BedrockGameplayBridge(client,{movement,clock:()=>now}).start();
  initialized(client,bridge);
  assert.equal(bridge.movementAuthority,1);
  assert.equal(movement.snapshot().presenceActive,true);
  assert.equal(movement.capability(bridge),'unavailable',
    'presence is independent of opting in to locomotion');
  for(let i=0;i<10;i++){
    now+=50;
    for(const callback of [...intervals.values()])callback();
  }
  assert.equal(movement.snapshot().presenceFrames,10);
  assert.equal(client.sent.length,10);
  assert.ok(client.sent.every(s=>s.packet==='player_auth_input'));
  assert.ok(client.sent.every(s=>s.value.input_data.length===0));
  assert.ok(client.sent.every(s=>s.value.position.x===origin.x && s.value.position.z===origin.z));
  assert.deepEqual(client.sent.map(s=>s.value.tick),
    Array.from({length:10},(_,i)=>BigInt(101+i)));
  bridge.stop();
  assert.equal(movement.snapshot().presenceActive,false);
  const before=client.sent.length;
  for(const callback of [...intervals.values()])callback();
  assert.equal(client.sent.length,before);
});

test('presence and opted-in movement share one ordered input stream with no overlap',()=>{
  const client=new Client();
  let now=1000,intervals=new Map(),counter=0;
  const movement=new ExperimentalPlayerInput(client,true,{
    presenceEnabled:true,clock:()=>now,
    setInterval:callback=>{const id=++counter;intervals.set(id,callback);return id;},
    clearInterval:id=>intervals.delete(id)
  });
  const bridge=new BedrockGameplayBridge(client,{movement,clock:()=>now}).start();
  initialized(client,bridge);
  const tick=()=>{now+=50;for(const callback of [...intervals.values()])callback();};
  tick();tick();
  assert.equal(bridge.execute({version:'minepilot.gameplay.v1',requestId:'motion',
    action:'motion_diagnostic',mode:'forward',ticks:2,confirmed:true}).status,'accepted');
  tick();tick();tick();tick();
  const frames=client.sent.filter(s=>s.packet==='player_auth_input');
  assert.ok(frames.length>=6);
  assert.ok(frames.every((s,i)=>i===0||s.value.tick>frames[i-1].value.tick));
  assert.ok(frames.some(s=>s.value.input_data.includes(10)));
  assert.equal(movement.snapshot().presenceActive,true);
  client.emit('change_dimension',{dimension:1});
  assert.equal(movement.snapshot().presenceActive,false);
  assert.equal(intervals.size,0);
  bridge.stop();
});

test('authority inferred from modern protocol, explicit rewind and new dimension reset',()=>{
  const client=new Client();
  const bridge=new BedrockGameplayBridge(client).start();
  client.emit('start_game',{...start,movement_authority:undefined,rewind_history_size:40});
  assert.equal(bridge.movementAuthority,2);
  assert.equal(bridge.snapshot().movementAuthoritySource,'protocol_1_26_default');
  client.emit('change_dimension',{dimension:1});
  assert.equal(bridge.movementAuthority,null);
  client.emit('start_game',{...start,movement_authority:undefined,rewind_history_size:0});
  assert.equal(bridge.movementAuthority,1);
  bridge.stop();
});


test('neutral presence packets serialize with pinned Bedrock 1.26.60 SDK, no movement flags',()=>{
  const client=new Client();
  let pulse;
  const movement=new ExperimentalPlayerInput(client,false,{
    presenceEnabled:true,clock:()=>1000,
    setInterval:cb=>{pulse=cb;return 7;},clearInterval:()=>{}
  });
  const bridge=new BedrockGameplayBridge(client,{movement,clock:()=>1000}).start();
  initialized(client,bridge);
  pulse();
  const frame=client.sent.at(-1);
  assert.equal(frame.packet,'player_auth_input');
  assert.deepEqual(frame.value.input_data,[]);
  assert.deepEqual(frame.value.position,origin);
  const {createSerializer}=require('bedrock-protocol/src/transforms/serializer');
  const serializer=createSerializer('1.26.60');
  const encoded=serializer.createPacketBuffer({name:frame.packet,params:frame.value});
  assert.ok(Buffer.isBuffer(encoded)&&encoded.length>10);
  bridge.stop();
});

test('neutral presence maintains bot input when idle spawn coordinates have no fresh self movement echo',()=>{
  const client=new Client();
  let now=1000,pulse;
  const movement=new ExperimentalPlayerInput(client,true,{
    presenceEnabled:true,clock:()=>now,
    setInterval:cb=>{pulse=cb;return 7;},clearInterval:()=>{}
  });
  const bridge=new BedrockGameplayBridge(client,{movement,clock:()=>now}).start();
  initialized(client,bridge);
  now+=31_000;
  pulse();
  assert.equal(movement.snapshot().presenceFrames,1);
  assert.equal(movement.capability(bridge),'experimental');
  assert.equal(movement.snapshot().movementVerified,false);
  bridge.stop();
});

test('ODYSSEY read-only observation results survive the private IPC receipt boundary', t => {
  const dir = mkdtempSync(join(tmpdir(), 'minepilot-odyssey-observe-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const commandPath = join(dir, 'command.json'), receiptPath = join(dir, 'receipt.json');
  const layerThree = { reset() {}, snapshot: () => ({}), inventoryItems: () => ({ known: true, observedAt: 10000,
    counts: { 'minecraft:oak_log': 4 } }) };
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, { commandPath, receiptPath, layerThree,
    clock: () => 10000 }).start();
  t.after(() => bridge.stop());
  initialized(client, bridge);
  // Keep the inventory snapshot time aligned with the bridge clock.
  const command = { version: 'minepilot.gameplay.v1', requestId: 'odyssey-1',
    action: 'odyssey_observe', confirmed: true, primitive: 'getLogsCount' };
  writeFileSync(commandPath, JSON.stringify(command));
  bridge.poll();
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.status, 'ok');
  assert.equal(receipt.primitive, 'getLogsCount');
  assert.equal(receipt.result, 4);
  assert.equal(receipt.verifiedBy, 'server_inventory_content');
  assert.equal(receipt.readOnly, true);
  assert.equal(receipt.executed, false);
  bridge.stop();
});


test('general gameplay start reconciles learning results and generic stop cannot take ownership', () => {
  const client = new Client();
  let agent = { active: false, goal: 'none', reason: 'gameplay_run_budget_exhausted', serverVerifiedSteps: 3 };
  let starts = 0, stops = 0;
  const gameplayAgent = {
    snapshot: () => ({ ...agent }),
    start(_world, options) {
      starts++;
      agent = { active: true, goal: options.goal, reason: 'running', serverVerifiedSteps: 0 };
      return { status: 'accepted', reason: 'started' };
    },
    stop(reason) {
      stops++;
      agent = { ...agent, active: false, reason };
      return { status: 'ok', reason };
    }
  };
  const bridge = new BedrockGameplayBridge(client, { gameplayAgent }).start();
  initialized(client, bridge);
  agent = { active: false, goal: 'none', reason: 'gameplay_run_budget_exhausted', serverVerifiedSteps: 3 };
  const engine = learningEngineFor(bridge);
  engine.activeRun = {
    taskId: 'safe_exploration', goal: 'explore', title: 'Safe exploration',
    steps: [], startedAt: 1, sessionId: 'test-session',
    requestedStop: false, owner: 'manual', seenActive: true
  };
  const start = bridge.execute({ version: 'minepilot.gameplay.v1', requestId: 'new-goal',
    action: 'agent_start', confirmed: true, goal: 'survive' });
  assert.equal(start.status, 'accepted');
  assert.equal(engine.activeRun, null);
  assert.equal(engine.recentRuns.at(-1).taskId, 'safe_exploration');
  assert.equal(engine.recentRuns.at(-1).outcome, 'verified');
  assert.equal(starts, 1);

  engine.activeRun = {
    taskId: 'safe_exploration', goal: 'explore', title: 'Safe exploration',
    steps: [], startedAt: 2, sessionId: 'test-session',
    requestedStop: false, owner: 'manual', seenActive: true
  };
  const beforeStops = stops;
  const stop = bridge.execute({ version: 'minepilot.gameplay.v1', requestId: 'wrong-stop',
    action: 'agent_stop' });
  assert.equal(stop.status, 'rejected');
  assert.equal(stop.reason, 'learning_task_owned_use_learning_stop');
  assert.equal(stops, beforeStops);
  bridge.stop();
});


test('ODYSSEY execute IPC gates and dispatches only bounded goto, exploreUntil and manual mineBlock', () => {
  const client=new Client();
  const starts=[];
  const gameplayAgent={
    snapshot:()=>({active:false}),
    start(_world,options){starts.push(options);return {status:'accepted',reason:'started'};},
    stop(){return {status:'ok'};}
  };
  const breaks=[];
  const blockBreaker={snapshot(){return {};},abort(){},start(_world,position,confirmed){breaks.push({position,confirmed});return {status:'accepted',reason:'queued_not_verified'};}};
  const bridge=new BedrockGameplayBridge(client,{gameplayAgent,blockBreaker}).start();
  initialized(client,bridge);
  const call=(primitive,args={},confirmed=true)=>bridge.execute({
    version:'minepilot.gameplay.v1',requestId:'odyssey-exec',action:'odyssey_execute',
    primitive,args,confirmed
  });
  assert.equal(call('exploreUntil',{},false).reason,'confirmation_required');
  const explore = call('exploreUntil');
  assert.equal(explore.status,'accepted');
  assert.equal(explore.awaitingServerConfirmation,true);
  assert.deepEqual(starts.at(-1),{confirmed:true,goal:'explore'});
  const goto = call('goto',{targetPosition:{x:9,y:64,z:10}});
  assert.equal(goto.status,'accepted');
  assert.equal(goto.awaitingServerConfirmation,true);
  assert.deepEqual(starts.at(-1),{confirmed:true,goal:'goto',targetPosition:{x:9,y:64,z:10}});
  assert.equal(call('goto',{targetPosition:{x:Infinity,y:64,z:10}}).reason,'valid_target_position_required');
  const mine = call('mineBlock',{position:{x:8,y:63,z:10}});
  assert.equal(mine.status,'accepted');
  assert.equal(mine.awaitingServerConfirmation,true);
  assert.deepEqual(breaks.at(-1),{position:{x:8,y:63,z:10},confirmed:true});
  assert.equal(call('craftItem').reason,'primitive_executor_unavailable');
  bridge.stop();
});


test('StartGame inventory transaction negotiation is tracked without assuming a mode', () => {
  const enabledClient = new Client();
  const enabled = new BedrockGameplayBridge(enabledClient).start();
  enabledClient.emit('start_game', { ...start, enable_item_stack_net_manager: true });
  assert.equal(enabled.snapshot().itemStackNetManager, true);
  assert.equal(enabled.snapshot().inventoryTransactionMode, 'server_authoritative');
  assert.equal(enabled.snapshot().stackRequests.enabled, true);
  enabled.stop();

  const legacyClient = new Client();
  const legacy = new BedrockGameplayBridge(legacyClient).start();
  legacyClient.emit('start_game', { ...start, enable_item_stack_net_manager: false });
  assert.equal(legacy.snapshot().itemStackNetManager, false);
  assert.equal(legacy.snapshot().inventoryTransactionMode, 'legacy');
  assert.equal(legacy.snapshot().stackRequests.enabled, false);
  legacy.stop();

  const unknownClient = new Client();
  const unknown = new BedrockGameplayBridge(unknownClient).start();
  unknownClient.emit('start_game', start);
  assert.equal(unknown.snapshot().itemStackNetManager, null);
  assert.equal(unknown.snapshot().inventoryTransactionMode, 'unknown');
  assert.equal(unknown.snapshot().stackRequests.enabled, false);
  unknown.stop();
});


test('tool equip selects only a server-observed hotbar slot and waits for matching mob equipment', () => {
  let now = 1000;
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, { clock: () => now }).start();
  initialized(client, bridge);
  bridge.layerThree = { reset() {}, snapshot: () => ({}), hotbarItems: () => ({ known: true, observedAt: now, slots: [
    { slot: 2, itemName: 'minecraft:iron_axe', count: 1, networkId: 7 },
    { slot: 5, itemName: 'minecraft:stone', count: 32, networkId: 9 }
  ] }) };
  const call = primitive => bridge.execute({ version: 'minepilot.gameplay.v1',
    requestId: 'equip-tool', action: 'odyssey_execute', primitive, args: {}, confirmed: true });
  const result = call('equipAxe');
  assert.equal(result.status, 'accepted');
  assert.equal(result.awaitingServerConfirmation, true);
  assert.deepEqual(client.sent.at(-1), { packet: 'player_hotbar',
    value: { selected_slot: 2, window_id: 0, select_slot: true } });
  assert.equal(bridge.snapshot().hotbarSelection.pending.status, 'awaiting_server_confirmation');
  client.emit('mob_equipment', { runtime_entity_id: 123n, selected_slot: 2, slot: 2,
    item: { network_id: 7, count: 1 } });
  assert.equal(bridge.snapshot().hotbarSelection.pending, null);
  assert.equal(bridge.snapshot().hotbarSelection.last.status, 'verified');
  assert.equal(bridge.snapshot().hotbarSelection.last.itemName, 'minecraft:iron_axe');
  bridge.stop();
});

test('tool equip fails closed without fresh hotbar inventory or a matching tool', () => {
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client).start();
  initialized(client, bridge);
  bridge.layerThree = { reset() {}, snapshot: () => ({}), hotbarItems: () => ({ known: false, observedAt: null, slots: [] }) };
  const call = primitive => bridge.execute({ version: 'minepilot.gameplay.v1',
    requestId: 'equip-tool-blocked', action: 'odyssey_execute', primitive, args: {}, confirmed: true });
  assert.equal(call('equipPickaxe').reason, 'fresh_hotbar_inventory_required');
  bridge.layerThree = { reset() {}, snapshot: () => ({}), hotbarItems: () => ({ known: true, observedAt: Date.now(), slots: [] }) };
  assert.equal(call('equipPickaxe').reason, 'matching_tool_not_in_hotbar');
  assert.equal(client.sent.length, 0);
  bridge.stop();
});


test('hotbar capability is experimental only while a complete server inventory snapshot is fresh', () => {
  const stale = { clock: () => 12000,
    layerThree: { hotbarItems: () => ({ known: true, observedAt: 1000, slots: [] }) } };
  const fresh = { clock: () => 12000,
    layerThree: { hotbarItems: () => ({ known: true, observedAt: 3000, slots: [] }) } };
  assert.equal(odysseyCapabilityStates(stale, {}).hotbar_selection.state, 'blocked');
  assert.equal(odysseyCapabilityStates(fresh, {}).hotbar_selection.state, 'experimental');
});


test('unconfirmed hotbar selection times out and can be retried without claiming success', () => {
  let now = 1000;
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, { clock: () => now }).start();
  initialized(client, bridge);
  bridge.layerThree = { reset() {}, snapshot: () => ({}), hotbarItems: () => ({ known: true, observedAt: 1000, slots: [
    { slot: 1, itemName: 'minecraft:stone_sword', count: 1, networkId: 15 }
  ] }) };
  const call = () => bridge.execute({ version: 'minepilot.gameplay.v1',
    requestId: 'equip-timeout', action: 'odyssey_execute',
    primitive: 'equipSword', args: {}, confirmed: true });
  assert.equal(call().status, 'accepted');
  now = 6001;
  assert.equal(bridge.snapshot().hotbarSelection.last.status, 'timed_out');
  assert.equal(bridge.snapshot().hotbarSelection.pending, null);
  assert.equal(call().status, 'accepted');
  assert.equal(client.sent.filter(x => x.packet === 'player_hotbar').length, 2);
  assert.equal(bridge.snapshot().hotbarSelection.last, null);
  bridge.stop();
});


test('world snapshots do not run intelligence decisions or update navigation intents', () => {
  const client = new Client();
  let decisions = 0;
  let navigationUpdates = 0;
  const intelligence = {
    reset() {},
    snapshot: () => ({ decisionCount: decisions }),
    decide() { decisions++; return { decisionCount: decisions }; },
    shouldEmergencyStop: () => false,
    noteOutcome() {}
  };
  const addonNavigation = {
    reset() {},
    snapshot: () => ({ state: 'idle', reason: 'no_live_intent', executed: false }),
    request() { return { accepted: true }; },
    release() {},
    update() {
      navigationUpdates++;
      return { state: 'idle', reason: 'no_live_intent', executed: false };
    }
  };
  const bridge = new BedrockGameplayBridge(client, { intelligence, addonNavigation }).start();
  initialized(client, bridge);

  bridge.snapshot();
  bridge.snapshot();
  assert.equal(decisions, 0);
  assert.equal(navigationUpdates, 0);

  bridge.tickControlPlane();
  assert.equal(decisions, 1);
  assert.equal(navigationUpdates, 1);
  bridge.stop();
});


test('bridge mirrors full Bedrock inventory content and incremental slots without refreshing snapshot age', () => {
  let now = 1000;
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, { clock: () => now }).start();
  initialized(client, bridge);
  client.emit('item_registry', { itemstates: [
    { runtime_id: 5, name: 'minecraft:oak_log' },
    { runtime_id: 8, name: 'minecraft:stick' }
  ] });
  const empty = () => ({ network_id: 0, count: 0, metadata: 0,
    has_stack_id: false, block_runtime_id: 0 });
  const items = Array.from({ length: 36 }, empty);
  items[0] = { network_id: 5, count: 4, metadata: 0, has_stack_id: true,
    stack_id: 22, block_runtime_id: 0 };
  client.emit('inventory_content', { window_id: 0, input: items,
    container: { container_id: 'hotbar_and_inventory' }, storage_item: empty() });
  let snapshot = bridge.snapshot();
  assert.equal(snapshot.inventory.player.known, true);
  assert.equal(snapshot.inventory.player.fresh, true);
  assert.equal(snapshot.inventory.player.items[0].itemName, 'minecraft:oak_log');
  assert.equal(snapshot.inventory.player.items[0].stackId, 22);
  assert.equal(odysseyCapabilityStates(bridge, {
    worldReady: true, localNavigationReady: false, skills: []
  }).inventory_read.state, 'ready');

  now = 20000;
  client.emit('inventory_slot', { window_id: 0, slot: 0,
    item: { network_id: 5, count: 3, metadata: 0, has_stack_id: true,
      stack_id: 23, block_runtime_id: 0 } });
  snapshot = bridge.snapshot();
  assert.equal(snapshot.inventory.player.fresh, false,
    'an incremental slot update must not renew the complete inventory snapshot');
  assert.equal(snapshot.inventory.player.items[0].stackId, 23);
  assert.equal(odysseyCapabilityStates(bridge, {
    worldReady: true, localNavigationReady: false, skills: []
  }).inventory_read.state, 'partial');
  bridge.stop();
});


test('1.26.60 subchunk batches decode center-relative offsets and all-air results', () => {
  const terrain = new BedrockTerrainCache();
  terrain.reset(0);
  terrain.setRegistry(new Map([[0, { name: 'minecraft:air', boundingBox: 'empty' }]]));
  const payload = Buffer.from([9, 1, 5, 1, 1, 0]);
  const decoded = terrain.subChunk({
    dimension: 0,
    center: { x: 3, y: 4, z: 2 },
    entries: [{
      sub_chunk_pos_offset: { x: 1, y: 1, z: 1 },
      result: 1,
      payload
    }, {
      sub_chunk_pos_offset: { x: 0, y: 2, z: 0 },
      result: 6
    }]
  });
  assert.equal(decoded, 2);
  assert.equal(terrain.snapshot().decodedSections, 2);
  assert.equal(terrain.blockId(0, 64, 80, 48), 0,
    'center plus relative offset resolves the expected subchunk column');
  assert.equal(terrain.blockName(0, 64, 80, 48), 'minecraft:air');
  assert.equal(terrain.blockId(0, 48, 96, 32), 0,
    'SuccessAllAir uses the registry air runtime ID without an absent payload');
});

test('the live bridge forwards official subchunk packets into its terrain cache', () => {
  const client = new Client();
  const terrain = new BedrockTerrainCache();
  const bridge = new BedrockGameplayBridge(client, {
    terrain,
    registryResolver: () => new Map([[0, { name: 'minecraft:air', boundingBox: 'empty' }]])
  }).start();
  client.emit('start_game', start);
  client.emit('spawn');
  client.emit('subchunk', {
    dimension: 0,
    center: { x: 0, y: 4, z: 0 },
    entries: [{
      sub_chunk_pos_offset: { x: 0, y: 0, z: 0 },
      result: 1,
      payload: Buffer.from([9, 1, 4, 1, 1, 0])
    }]
  });
  assert.equal(bridge.snapshot().terrain.decodedSections, 1);
  assert.equal(bridge.snapshot().terrain.collisionClassificationReady, true);
  bridge.stop();
});

test('manual D-pad directions serialize independent forward, backward and strafe inputs', () => {
  const client = new Client();
  let now = 1000;
  let pulse = null;
  const movement = new ExperimentalPlayerInput(client, true, {
    clock: () => now,
    setInterval: callback => { pulse = callback; return 1; },
    clearInterval: () => {}
  });
  const bridge = new BedrockGameplayBridge(client, { movement, clock: () => now }).start();
  initialized(client, bridge);
  const expected = [
    ['forward', { x: 0, z: 1 }, 10],
    ['backward', { x: 0, z: -1 }, 11],
    ['strafe_left', { x: -1, z: 0 }, 12],
    ['strafe_right', { x: 1, z: 0 }, 13]
  ];
  for (const [mode, vector, flag] of expected) {
    const result = bridge.execute({
      version: 'minepilot.gameplay.v1', requestId: mode,
      action: 'manual_move', confirmed: true, mode, ticks: 2
    });
    assert.equal(result.status, 'accepted', mode);
    now += 50;
    pulse();
    const frame = client.sent.at(-1).value;
    assert.deepEqual(frame.move_vector, vector, mode);
    assert.deepEqual(frame.raw_move_vector, vector, mode);
    assert.deepEqual(frame.input_data, [flag], mode);
    bridge.execute({
      version: 'minepilot.gameplay.v1', requestId: mode + '-release',
      action: 'manual_stop'
    });
    assert.equal(movement.snapshot().active, false, mode);
  }
  bridge.stop();
});

test('manual movement is still blocked by missing authority, critical health and the active autonomous agent', () => {
  const client = new Client();
  let pulse;
  const movement = new ExperimentalPlayerInput(client, false, {
    setInterval: callback => { pulse = callback; return 1; },
    clearInterval: () => {}
  });
  const bridge = new BedrockGameplayBridge(client, {
    movement,
    gameplayAgent: { snapshot: () => ({ active: true }), stop() {} }
  }).start();
  initialized(client, bridge);
  const base = {
    version: 'minepilot.gameplay.v1', requestId: 'manual-test',
    action: 'manual_move', confirmed: true, mode: 'forward', ticks: 4
  };
  assert.equal(bridge.execute(base).reason, 'autonomous_controller_busy');
  bridge.gameplayAgent = { snapshot: () => ({ active: false }), stop() {} };
  assert.equal(bridge.execute({ ...base, requestId: 'manual-disabled' }).reason, 'movement_unavailable');
  bridge.stop();
});
