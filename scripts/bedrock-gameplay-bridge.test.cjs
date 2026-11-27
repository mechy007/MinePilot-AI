'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { test } = require('node:test');
const { BedrockGameplayBridge } = require('./bedrock-gameplay-bridge.cjs');
const { learningEngineFor, odysseyCapabilityStates } = require('./bedrock-skill-manifest.cjs');
const { BedrockTerrainCache } = require('./bedrock-terrain-cache.cjs');

async function importGameplay(moduleName) {
  const stagedPaths = [
    join(__dirname, 'gameplay', `${moduleName}.js`),
    join(__dirname, '..', 'gameplay', `${moduleName}.js`)
  ];
  const builtPath = join(__dirname, '..', 'dist', 'src', 'gameplay', `${moduleName}.js`);
  const target = stagedPaths.find(existsSync) ?? builtPath;
  if (!existsSync(target)) throw new Error(`Gameplay module is not staged or built: ${moduleName}`);
  return import(require('node:url').pathToFileURL(target).href);
}

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
test('manual move commands reach the active controller and release through the same bridge', () => {
  const client = new Client();
  let received = null;
  let releases = 0;
  const movement = {
    capability() { return 'unavailable'; },
    runManualHold(world, options) { received = { world, options }; return { status: 'accepted', reason: 'movement_controls_applied' }; },
    releaseManual() { releases++; return true; },
    stop() {}, stopPresence() {}, snapshot() { return { capability: 'ready' }; }
  };
  const bridge = new BedrockGameplayBridge(client, { movement }).start();
  client.emit('start_game', start);
  client.emit('spawn');
  const result = bridge.execute({
    version: 'minepilot.gameplay.v1', requestId: 'manual-vector', action: 'manual_move',
    confirmed: true, mode: 'vector', ticks: 8, motionX: 0.4, motionY: 0.7,
    jump: true, sprint: true, sneak: false
  });
  assert.equal(result.status, 'accepted');
  assert.equal(received.world, bridge);
  assert.deepEqual(received.options, { mode: 'vector', ticks: 8, vector: { x: 0.4, y: 0.7 },
    jump: true, sprint: true, sneak: false });
  const stopped = bridge.execute({
    version: 'minepilot.gameplay.v1', requestId: 'manual-release', action: 'manual_stop'
  });
  assert.equal(stopped.status, 'ok');
  assert.equal(releases, 1);
  bridge.stop();
});

test('rotation-only MovePlayer packets never rewrite position or clear movement prediction', () => {
  const client = new Client();
  let rotations = 0, observed = 0, teleports = 0;
  const movement = {
    observeRotation() { rotations++; },
    observeServerPosition() { observed++; },
    teleport() { teleports++; },
    stop() {}, stopPresence() {}, snapshot() { return {}; }
  };
  const bridge = new BedrockGameplayBridge(client, { movement }).start();
  client.emit('start_game', start);
  client.emit('spawn');
  const before = { ...bridge.position };
  client.emit('move_player', { runtime_entity_id: 123n,
    position: { x: 999, y: 80, z: 999 }, yaw: 45, pitch: -10, mode: 3 });
  assert.deepEqual(bridge.position, before);
  assert.equal(rotations, 1);
  assert.equal(observed, 0);
  assert.equal(teleports, 0);
  client.emit('move_player', { runtime_entity_id: 123n,
    position: { x: 10, y: 64, z: 11 }, yaw: 90, pitch: 0, mode: 0 });
  assert.deepEqual(bridge.position, { x: 10, y: 64, z: 11 });
  assert.equal(observed, 1);
  assert.equal(teleports, 0);
  client.emit('move_player', { runtime_entity_id: 123n,
    position: { x: 20, y: 70, z: 20 }, yaw: 0, pitch: 0, mode: 2 });
  assert.equal(teleports, 1);
  bridge.stop();
});

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

test('Android gameplay inbox carries joystick commands through controller execution and receipts', t => {
  const dir = mkdtempSync(join(tmpdir(), 'minepilot-gameplay-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const commandPath = join(dir, 'command.json'), receiptPath = join(dir, 'receipt.json');
  let stops = 0, releases = 0;
  const manualInputs = [];
  const client = new Client();
  const movement = {
    stop() { stops++; },
    capability() { return 'ready'; },
    runManualHold(world, options) {
      manualInputs.push(options);
      return { status: 'accepted', reason: 'movement_controls_applied' };
    },
    releaseManual() { releases++; return true; },
    snapshot() { return { capability: 'ready', active: true }; }
  };
  const bridge = new BedrockGameplayBridge(client, { commandPath, receiptPath, movement }).start();
  client.emit('start_game', start);
  client.emit('spawn');
  const cmd = (requestId, action, rest = {}) => {
    writeFileSync(commandPath, JSON.stringify({
      version: 'minepilot.gameplay.v1', requestId, action, ...rest
    }));
    bridge.poll();
    assert.equal(existsSync(commandPath), false);
    return JSON.parse(readFileSync(receiptPath, 'utf8'));
  };
  assert.equal(cmd('cmd-1', 'status').status, 'ok');
  const manual = cmd('cmd-manual', 'manual_move', {
    confirmed: true, mode: 'vector', ticks: 8, motionX: 0.4, motionY: 0.7,
    jump: true, sprint: true, sneak: false
  });
  assert.equal(manual.status, 'accepted');
  assert.equal(manual.requestId, 'cmd-manual');
  assert.equal(manual.dispatchAccepted, true);
  assert.equal(manual.executionStage, 'movement_controls_applied');
  assert.equal(manual.serverConfirmation, 'correction_only_if_prediction_differs');
  assert.deepEqual(manualInputs[0], {
    mode: 'vector', ticks: 8, vector: { x: 0.4, y: 0.7 },
    jump: true, sprint: true, sneak: false
  });
  const manualStop = cmd('cmd-manual-stop', 'manual_stop');
  assert.equal(manualStop.status, 'ok');
  assert.equal(releases, 1);
  assert.equal(cmd('cmd-2', 'stop_movement').reason, 'movement_cancelled');
  assert.equal(stops, 1);
  assert.equal(cmd('cmd-3', 'obsolete_movement_probe', { confirmed: true }).reason, 'invalid_command');
  assert.equal(cmd('cmd-4', 'mine').reason, 'invalid_command');
  writeFileSync(commandPath, '{"version":"minepilot.gameplay.v1","action":"status"');
  bridge.poll();
  const last = JSON.parse(readFileSync(receiptPath, 'utf8'));
  assert.equal(last.reason, 'invalid_command');
  assert.equal(last.dispatchAccepted, false);
  bridge.stop();
  assert.equal(stops, 2);
});

test('Layer 2 equipment, target removal and health override are observational', async () => {
  const { LayerOneController } = await importGameplay('layer-one');
  const { LayerTwoPlanner } = await importGameplay('layer-two');
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
  const { LayerTwoPlanner } = await importGameplay('layer-two');
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

test('player names arriving after AddPlayer rehydrate the Follow target cache', async () => {
  const { LayerTwoPlanner } = await importGameplay('layer-two');
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, { layerTwo: new LayerTwoPlanner() }).start();
  initialized(client, bridge);
  client.emit('add_player', {
    runtime_entity_id: 200n, uuid: 'late-name-uuid',
    position: { x: 14, y: 64, z: 11 }
  });
  assert.deepEqual(bridge.snapshot().layerTwo.visiblePlayerNames, []);
  client.emit('player_list', { records: { type: 'add', records: [
    { uuid: 'late-name-uuid', username: 'LateFriend' }
  ] } });
  assert.deepEqual(bridge.snapshot().layerTwo.visiblePlayerNames, ['LateFriend']);
  const plan = bridge.execute({
    version: 'minepilot.gameplay.v1', requestId: 'late-follow',
    action: 'plan_follow', playerName: 'LateFriend'
  });
  assert.equal(plan.status, 'accepted');
  assert.equal(bridge.snapshot().layerTwo.preview.targetName, 'LateFriend');
  bridge.stop();
});

test('Layer 3 block updates do not imply mining, and dimension resets resource targets', async () => {
  const { LayerThreePlanner } = await importGameplay('layer-three');
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

test('Layer 7 optional advisor sees same-client survival and workflow state but never executes actions', async () => {
  const { LayerOneController } = await importGameplay('layer-one');
  const { LayerFourSupervisor } = await importGameplay('layer-four');
  const { LayerSevenAdvisor } = await importGameplay('layer-seven');
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
  const { LayerEightReadiness } = await importGameplay('layer-eight');
  const { LayerSixWorkflow } = await importGameplay('layer-six');
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


test('respawn waits four seconds before the first Bedrock handshake and accepts zero runtime IDs', () => {
  let now = 1000;
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, { clock: () => now }).start();
  initialized(client, bridge);
  client.emit('update_attributes', { runtime_entity_id: 123n,
    attributes: [{ name: 'minecraft:health', current: 0 }] });
  assert.equal(bridge.snapshot().respawnRecovery.state, 'dead_waiting_for_server');
  client.emit('respawn', { runtime_entity_id: 0n, state: 0, position: origin });
  assert.equal(client.sent.length, 0);
  client.emit('respawn', { runtime_entity_id: '0', state: 1,
    position: { x: 12.5, y: 70, z: 8.5 } });
  assert.equal(client.sent.length, 0, 'early ReadyToSpawn does not bypass the delay');
  now += 3999;
  assert.equal(bridge.tickRespawnRecovery(), false);
  assert.equal(client.sent.length, 0);
  now += 1;
  assert.equal(bridge.tickRespawnRecovery(), true);
  assert.deepEqual(client.sent.map(packet => packet.packet), ['respawn', 'player_action']);
  assert.equal(client.sent[0].value.state, 2);
  assert.equal(client.sent[1].value.action, 'respawn');
  assert.equal(bridge.snapshot().respawnRecovery.state, 'respawn_action_sent');
  client.emit('update_attributes', { runtime_entity_id: 123n,
    attributes: [{ name: 'minecraft:health', current: 20 }] });
  assert.equal(bridge.snapshot().respawnRecovery.state, 'alive');
  assert.equal(bridge.snapshot().respawnRecovery.recovered, 1);
  assert.deepEqual(bridge.snapshot().position, { x: 12.5, y: 70, z: 8.5 });
  bridge.stop();
});

test('manual immediate respawn bypasses retry delay but preserves the server handshake', () => {
  let now = 1000;
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, { clock: () => now }).start();
  initialized(client, bridge);
  client.emit('update_attributes', { runtime_entity_id: 123n,
    attributes: [{ name: 'minecraft:health', current: 0 }] });

  const early = bridge.execute({ version: 'minepilot.gameplay.v1',
    requestId: 'manual-respawn-early', action: 'immediate_respawn' });
  assert.deepEqual(early, { status: 'rejected', reason: 'server_respawn_position_unavailable' });
  assert.equal(client.sent.length, 0);

  client.emit('respawn', { runtime_entity_id: 123n, state: 0, position: origin });
  const requested = bridge.execute({ version: 'minepilot.gameplay.v1',
    requestId: 'manual-respawn-now', action: 'immediate_respawn' });
  assert.deepEqual(requested, { status: 'ok', reason: 'immediate_respawn_requested' });
  assert.deepEqual(client.sent.map(packet => packet.packet), ['respawn']);
  assert.equal(client.sent[0].value.state, 2);

  // The server must still confirm its spawned state before PlayerAction(respawn).
  client.emit('respawn', { runtime_entity_id: 123n, state: 1, position: origin });
  assert.deepEqual(client.sent.map(packet => packet.packet), ['respawn', 'player_action']);
  assert.equal(client.sent[1].value.action, 'respawn');
  bridge.stop();
});

test('respawn recovery handles repeated deaths and runtime ID changes without a lifetime cap', () => {
  let now = 1000;
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, { clock: () => now }).start();
  initialized(client, bridge);
  const cycles = [
    { stateZeroId: 0n, stateOneId: 456n, x: 12.5 },
    { stateZeroId: 789n, stateOneId: 789n, x: 13.5 },
    { stateZeroId: 0n, stateOneId: 0n, x: 14.5 },
    { stateZeroId: 901n, stateOneId: 902n, x: 15.5 }
  ];
  let recovered = 0;
  for (const cycle of cycles) {
    client.emit('set_health', { health: 0 });
    assert.equal(bridge.snapshot().respawnRecovery.state, 'dead_waiting_for_server');
    client.emit('respawn', { runtime_entity_id: cycle.stateZeroId, state: 0,
      position: { x: cycle.x, y: 70, z: 8.5 } });
    client.emit('respawn', { runtime_entity_id: cycle.stateOneId, state: 1,
      position: { x: cycle.x, y: 70, z: 8.5 } });
    const before = client.sent.length;
    now += 3999;
    bridge.tickRespawnRecovery();
    assert.equal(client.sent.length, before);
    now += 1;
    bridge.tickRespawnRecovery();
    const activeId = cycle.stateOneId === 0n ? bridge.self : cycle.stateOneId.toString();
    assert.equal(bridge.self, activeId);
    const action = client.sent.filter(item => item.packet === 'player_action').at(-1);
    assert.ok(action);
    assert.equal(action.value.runtime_entity_id, BigInt(activeId));
    assert.equal(bridge.snapshot().respawnRecovery.state, 'respawn_action_sent');
    client.emit('set_health', { health: 20 });
    recovered++;
    assert.equal(bridge.snapshot().respawnRecovery.state, 'alive');
    assert.equal(bridge.snapshot().respawnRecovery.recovered, recovered);
  }
  assert.equal(bridge.snapshot().respawnRecovery.deaths, 4);
  assert.equal(bridge.snapshot().respawnRecovery.actionRequests, 4);
  bridge.stop();
});

test('respawn retries continue beyond three attempts with capped exponential backoff', () => {
  let now = 1000;
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, { clock: () => now }).start();
  initialized(client, bridge);
  client.emit('set_health', { health: 0 });
  client.emit('respawn', { runtime_entity_id: 0n, state: 0, position: origin });
  client.emit('respawn', { runtime_entity_id: 0n, state: 1, position: origin });
  assert.equal(bridge.snapshot().respawnRecovery.actionRequests, 0);
  now += 4000;
  bridge.tickRespawnRecovery();
  assert.equal(bridge.snapshot().respawnRecovery.actionRequests, 1);
  for (const [index, delay] of [1800, 3600, 7200, 10000].entries()) {
    now += delay;
    bridge.tickRespawnRecovery();
    assert.equal(bridge.snapshot().respawnRecovery.actionRequests, index + 2);
    const count = bridge.snapshot().respawnRecovery.actionRequests;
    bridge.tickRespawnRecovery();
    assert.equal(bridge.snapshot().respawnRecovery.actionRequests, count);
  }
  assert.equal(bridge.snapshot().respawnRecovery.error, null);
  client.emit('set_health', { health: 20 });
  assert.equal(bridge.snapshot().respawnRecovery.state, 'alive');
  bridge.stop();
});

test('respawn restores an active Follow plan only after server health recovery', () => {
  let now = 1000, autonomous = true, replanned = 0, restarted = 0;
  const client = new Client();
  const layerTwo = {
    reset() {},
    snapshot() { return {}; },
    preview() { return { goal: 'follow', targetName: 'Friend' }; },
    cancel() {},
    follow(name) { assert.equal(name, 'Friend'); replanned++; return { status: 'accepted' }; }
  };
  const autonomy = {
    snapshot() { return { active: autonomous }; },
    stop() { autonomous = false; },
    enable(world, options) {
      assert.equal(options.confirmed, true);
      restarted++; autonomous = true;
      return { status: 'accepted', reason: 'bounded_follow_autonomy_started' };
    }
  };
  const movement = { stop() {}, stopPresence() {}, startPresence() {} };
  const bridge = new BedrockGameplayBridge(client, { clock: () => now, layerTwo, autonomy, movement }).start();
  initialized(client, bridge);
  // startGame resets optional runtimes; explicitly enable the fake Follow task
  // after initialization to model a user-enabled task at the moment of death.
  autonomous = true;
  client.emit('set_health', { health: 0 });
  assert.equal(bridge.snapshot().respawnRecovery.resumeTask.goal, 'follow');
  assert.equal(autonomous, false);
  client.emit('respawn', { runtime_entity_id: 0n, state: 0, position: origin });
  client.emit('respawn', { runtime_entity_id: 0n, state: 1, position: origin });
  now += 4000;
  bridge.tickRespawnRecovery();
  assert.equal(replanned, 0);
  client.emit('set_health', { health: 20 });
  assert.equal(replanned, 1);
  assert.equal(restarted, 1);
  assert.equal(autonomous, true);
  assert.equal(bridge.snapshot().respawnRecovery.resumeResult, 'autonomous_task_resumed');
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
  const { LayerTwoPlanner } = await importGameplay('layer-two');
  const { BedrockMotionArbiter } = await importGameplay('addon-navigation');
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
  client.emit('mob_equipment', { runtime_entity_id: 123n, selected_slot: 2, slot: 2,
    item: { network_id: 99, count: 1 } });
  assert.equal(bridge.snapshot().hotbarSelection.last.status, 'invalidated');
  assert.equal(bridge.snapshot().hotbarSelection.last.reason, 'server_equipment_changed');
  const retry = call('equipAxe');
  assert.equal(retry.status, 'accepted');
  assert.equal(retry.awaitingServerConfirmation, true);
  assert.equal(bridge.snapshot().hotbarSelection.pending.status, 'awaiting_server_confirmation');
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
  const payload = Buffer.from([9, 1, 5, 1, 0]);
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
      payload: Buffer.from([9, 1, 4, 1, 0])
    }]
  });
  assert.equal(bridge.snapshot().terrain.decodedSections, 1);
  assert.equal(bridge.snapshot().terrain.collisionClassificationReady, true);
  bridge.stop();
});

test('vanilla runtime registry refuses hashed IDs but retains known states beside custom definitions', () => {
  const { createVanillaRuntimeRegistry, clearRuntimeRegistryCache } =
    require('./bedrock-runtime-registry.cjs');
  clearRuntimeRegistryCache();
  const load = () => ({ blocks: [
    { minStateId: 0, maxStateId: 1000, name: 'air', boundingBox: 'empty' }
  ] });
  const hashedRegistry = createVanillaRuntimeRegistry({
    server_version: '1.26.66.1', block_network_ids_are_hashes: true
  });
  assert.ok(hashedRegistry instanceof Map);
  assert.equal(hashedRegistry.get((-2144268767) >>> 0).name, 'minecraft:stone');
  // This fixture loader is intentionally synthetic. Real production
  // registries are sourced from the pinned palette and fail closed on custom IDs.
  const customRegistry = createVanillaRuntimeRegistry({
    server_version: '1.26.60',
    block_properties: [{ name: 'custom:example', states: {} }]
  }, load);
  assert.equal(customRegistry.size, 1001);
  assert.equal(customRegistry.get(0).name, 'minecraft:air');
  assert.equal(customRegistry.get(1001), undefined,
    'custom states without a verified numeric mapping remain unknown');
  clearRuntimeRegistryCache();
});


test('Bedrock 1.26.60 skeleton chunks trigger a bounded and deduplicated local subchunk request', () => {
  let now = 1000;
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, { clock: () => now }).start();
  client.emit('start_game', { ...start, player_position: { x: 33.25, y: 70.5, z: -17.75 } });
  const header = { x: 2, z: -2, dimension: 0, sub_chunk_count: 0xffffffff };
  client.emit('level_chunk', header);
  const request = client.sent.find(item => item.packet === 'subchunk_request');
  assert.ok(request, 'skeleton chunk requests actual block subchunks');
  assert.equal(request.value.dimension, 0);
  assert.deepEqual(request.value.origin, { x: 2, y: 4, z: -2 });
  assert.deepEqual(request.value.requests, [
    { x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 },
    { x: 0, y: 1, z: 0 }, { x: 0, y: -2, z: 0 },
    { x: 0, y: 2, z: 0 }
  ]);
  assert.equal(bridge.snapshot().subchunkRequestsSent, 1);
  client.emit('level_chunk', header);
  assert.equal(client.sent.filter(item => item.packet === 'subchunk_request').length, 1,
    'repeated skeleton chunk headers do not flood the server');
  now += 15001;
  client.emit('level_chunk', header);
  assert.equal(client.sent.filter(item => item.packet === 'subchunk_request').length, 2,
    'a new request can be retried after the cooldown');
  bridge.stop();
});

test('subchunk request packet shape is accepted by the pinned Bedrock 1.26.60 serializer', () => {
  const { createSerializer } = require('bedrock-protocol/src/transforms/serializer');
  const serializer = createSerializer('1.26.60');
  const buffer = serializer.createPacketBuffer({
    name: 'subchunk_request',
    params: {
      dimension: 0,
      requests: [{ x: 0, y: -2, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }],
      origin: { x: 2, y: 4, z: -2 }
    }
  });
  assert.ok(Buffer.isBuffer(buffer) && buffer.length > 10);
});


test('single-block placement requires Bedrock operator permission, observed air, acknowledgement and block-update proof', () => {
  const client = new Client();
  let blockName = 'minecraft:air';
  const terrain = {
    reset() {}, levelChunk() {},
    blockName(dimension, x, y, z) {
      return dimension === 0 && x === 8 && y === 64 && z === 10 ? blockName : null;
    },
    updateBlock() {},
    snapshot() { return { decodedSections: 1, registryEntries: 1 }; }
  };
  const bridge = new BedrockGameplayBridge(client, { terrain }).start();
  client.emit('start_game', {
    ...start, entity_id: 321n, enable_commands: true, permission_level: 'operator'
  });
  client.emit('spawn');
  client.emit('level_chunk', { x: 0, z: 0, dimension: 0 });
  const result = bridge.execute({
    version: 'minepilot.gameplay.v1', requestId: 'place-one',
    action: 'odyssey_execute', primitive: 'placeBlock', confirmed: true,
    args: { position: { x: 8, y: 64, z: 10 }, blockId: 'stone' }
  });
  assert.equal(result.status, 'accepted');
  const request = client.sent.find(packet => packet.packet === 'command_request');
  assert.ok(request);
  assert.equal(request.value.command, 'setblock 8 64 10 minecraft:stone keep');
  assert.equal(request.value.origin.type, 'Player');
  assert.equal(request.value.origin.player_entity_id, 321n);
  assert.equal(request.value.internal, false);
  assert.equal(request.value.version, 'Latest');

  client.emit('command_output', {
    origin: { request_id: request.value.origin.request_id },
    success_count: 1, output: [{ success: true }]
  });
  assert.equal(bridge.snapshot().blockPlacement.state, 'awaiting_server_confirmation');
  assert.equal(bridge.snapshot().blockPlacement.serverAcknowledged, true);
  assert.equal(bridge.snapshot().blockPlacement.serverObserved, false);

  blockName = 'minecraft:stone';
  client.emit('update_block', {
    position: { x: 8, y: 64, z: 10 }, block_runtime_id: 3317, layer: 0
  });
  assert.equal(bridge.snapshot().blockPlacement.status, 'ok');
  assert.equal(bridge.snapshot().blockPlacement.serverObserved, true);
  assert.equal(bridge.snapshot().blockPlacement.reason, 'block_placed_and_server_observed');
  bridge.stop();
});

test('single-block placement rejects non-operator and occupied targets without sending commands', () => {
  for (const permission of ['member', 'operator']) {
    const client = new Client();
    const terrain = {
      reset() {}, levelChunk() {}, updateBlock() {},
      blockName() { return permission === 'operator' ? 'minecraft:stone' : 'minecraft:air'; },
      snapshot() { return { decodedSections: 1, registryEntries: 1 }; }
    };
    const bridge = new BedrockGameplayBridge(client, { terrain }).start();
    client.emit('start_game', {
      ...start, entity_id: 321n, enable_commands: true, permission_level: permission
    });
    client.emit('spawn');
    client.emit('level_chunk', { x: 0, z: 0, dimension: 0 });
    const result = bridge.execute({
      version: 'minepilot.gameplay.v1', requestId: 'place-guard',
      action: 'odyssey_execute', primitive: 'placeBlock', confirmed: true,
      args: { position: { x: 8, y: 64, z: 10 }, blockId: 'stone' }
    });
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason, permission === 'operator'
      ? 'target_must_be_observed_air' : 'bedrock_operator_command_permission_required');
    assert.equal(client.sent.some(packet => packet.packet === 'command_request'), false);
    bridge.stop();
  }
});

test('block placement Bedrock command packet serializes against the pinned 1.26.60 protocol schema', () => {
  const { createSerializer } = require('bedrock-protocol/src/transforms/serializer');
  const serializer = createSerializer('1.26.60');
  const buffer = serializer.createPacketBuffer({
    name: 'command_request',
    params: {
      command: 'setblock 8 64 10 minecraft:stone keep',
      origin: {
        type: 'Player', uuid: '123e4567-e89b-42d3-a456-426614174000',
        request_id: '123e4567-e89b-42d3-a456-426614174001',
        player_entity_id: 321n
      },
      internal: false, version: 'Latest'
    }
  });
  assert.ok(Buffer.isBuffer(buffer) && buffer.length > 20);
});

test('Bedrock crafting dispatch requires exact server recipe, stack response and fresh inventory postcondition', async () => {
  let now = 1000;
  let currentInventory = {
    known: true, fresh: true, fullSnapshotFresh: true, registryKnown: true,
    unresolvedItemCount: 0, revision: 10, generation: 1, observedAt: now,
    items: [
      { slot: 0, itemName: 'minecraft:oak_log', count: 1, empty: false },
      { slot: 1, itemName: 'minecraft:oak_planks', count: 0, empty: false }
    ]
  };
  const inventoryLedger = {
    reset() {},
    observeItemRegistry() {},
    observeContent() {},
    playerInventory() { return currentInventory; },
    snapshot() { return { player: currentInventory, windows: [] }; }
  };
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, {
    clock: () => now, inventoryLedger
  }).start();
  client.emit('start_game', { ...start, enable_item_stack_net_manager: true });
  client.emit('spawn');
  client.emit('level_chunk', { x: 0, z: 0, dimension: 0 });
  client.emit('item_registry', { itemstates: [
    { runtime_id: 1, name: 'minecraft:oak_log' },
    { runtime_id: 2, name: 'minecraft:oak_planks' }
  ] });
  client.emit('crafting_data', { clear_recipes: true, shaped_recipes: [], shapeless_recipes: [{
    recipe_id: 'minecraft:oak_planks',
    network_id: 42,
    input: [{ type: 1, descriptor_type: 'name', name: 'minecraft:oak_log', metadata: 0, count: 1 }],
    output: [{ network_id: 2, count: 4, metadata: 0 }],
    block: 'crafting_table'
  }] });

  const result = bridge.execute({
    version: 'minepilot.gameplay.v1', requestId: 'craft-one',
    action: 'odyssey_execute', primitive: 'craftRecipe', confirmed: true,
    args: { resultItem: 'minecraft:oak_planks', timesCrafted: 1 }
  });
  assert.equal(result.status, 'accepted');
  assert.equal(result.awaitingServerConfirmation, true);
  const packet = client.sent.find(item => item.packet === 'item_stack_request');
  assert.ok(packet);
  assert.deepEqual(packet.value.requests[0].actions[0], {
    type_id: 'craft_recipe', legacy_type_id: 12,
    recipe_network_id: 42, times_crafted: 1
  });

  client.emit('item_stack_response', { responses: [{ request_id: -1, status: 'ok' }] });
  await Promise.resolve();
  now = 1010;
  currentInventory = {
    ...currentInventory, revision: 11, observedAt: now,
    items: [
      { slot: 0, itemName: 'minecraft:oak_log', count: 0, empty: false },
      { slot: 1, itemName: 'minecraft:oak_planks', count: 4, empty: false }
    ]
  };
  client.emit('inventory_content', { window_id: 0, container: { container_id: 'hotbar_and_inventory' }, input: [] });
  const crafting = bridge.snapshot().crafting;
  assert.equal(crafting.status, 'ok');
  assert.equal(crafting.reason, 'craft_response_and_inventory_verified');
  assert.equal(crafting.serverAcknowledged, true);
  assert.equal(crafting.inventoryVerified, true);
  bridge.stop();
});

test('Bedrock crafting rejects unsupported recipe, stale inventory and unnegotiated stack transactions', () => {
  const client = new Client();
  let currentInventory = {
    known: true, fresh: false, fullSnapshotFresh: false, registryKnown: true,
    unresolvedItemCount: 0, revision: 1, generation: 1, observedAt: 1000, items: []
  };
  const inventoryLedger = {
    reset() {}, observeItemRegistry() {}, observeContent() {},
    playerInventory() { return currentInventory; },
    snapshot() { return { player: currentInventory, windows: [] }; }
  };
  const bridge = new BedrockGameplayBridge(client, { inventoryLedger }).start();
  client.emit('start_game', { ...start, enable_item_stack_net_manager: false });
  client.emit('spawn');
  client.emit('level_chunk', { x: 0, z: 0, dimension: 0 });
  const result = bridge.execute({
    version: 'minepilot.gameplay.v1', requestId: 'craft-blocked',
    action: 'odyssey_execute', primitive: 'craftRecipe', confirmed: true,
    args: { resultItem: 'minecraft:oak_planks' }
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'server_authoritative_inventory_not_negotiated');
  assert.equal(client.sent.some(item => item.packet === 'item_stack_request'), false);
  bridge.stop();

  currentInventory = { ...currentInventory, fresh: true, fullSnapshotFresh: true };
});


test('respawn does not resume movement when health arrives before the server spawn position', () => {
  let now = 1000;
  let starts = 0;
  const client = new Client();
  const movement = {
    startPresence() { starts++; },
    stopPresence() {},
    stop() {}
  };
  const bridge = new BedrockGameplayBridge(client, { clock: () => now, movement }).start();
  initialized(client, bridge);
  const startsBeforeDeath = starts;
  client.emit('set_health', { health: 0 });
  client.emit('respawn', { runtime_entity_id: 0n, state: 0,
    position: { x: 12.5, y: 70, z: 8.5 } });
  client.emit('set_health', { health: 20 });
  assert.equal(bridge.snapshot().respawnRecovery.state, 'dead_waiting_for_server');
  assert.equal(bridge.spawned, false);
  assert.equal(starts, startsBeforeDeath, 'health alone must not restart movement');

  client.emit('respawn', { runtime_entity_id: 456n, state: 1,
    position: { x: 18.5, y: 72, z: 4.5 } });
  assert.equal(bridge.snapshot().respawnRecovery.state, 'alive');
  assert.deepEqual(bridge.snapshot().position, { x: 18.5, y: 72, z: 4.5 });
  assert.equal(bridge.spawned, true);
  assert.equal(starts, startsBeforeDeath + 1);
  bridge.stop();
});

test('server returning to SearchingForSpawn restarts the correct respawn handshake stage', () => {
  let now = 1000;
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, { clock: () => now }).start();
  initialized(client, bridge);
  client.emit('set_health', { health: 0 });
  client.emit('respawn', { runtime_entity_id: 0n, state: 0, position: origin });
  client.emit('respawn', { runtime_entity_id: 0n, state: 1, position: origin });
  now += 4000;
  bridge.tickRespawnRecovery();
  assert.equal(bridge.snapshot().respawnRecovery.actionRequests, 1);
  assert.equal(bridge.snapshot().respawnRecovery.state, 'respawn_action_sent');

  client.emit('respawn', { runtime_entity_id: 789n, state: 0,
    position: { x: 14.5, y: 70, z: 11.5 } });
  assert.equal(bridge.snapshot().respawnRecovery.state, 'dead_waiting_for_server');
  const sentBeforeRetry = client.sent.length;
  now += 1799;
  bridge.tickRespawnRecovery();
  assert.equal(client.sent.length, sentBeforeRetry);
  now += 1;
  bridge.tickRespawnRecovery();
  assert.equal(client.sent.at(-1).packet, 'respawn');
  assert.equal(bridge.snapshot().respawnRecovery.state, 'client_ready_sent');
  client.emit('respawn', { runtime_entity_id: 789n, state: 1,
    position: { x: 14.5, y: 70, z: 11.5 } });
  assert.equal(client.sent.at(-1).packet, 'player_action');
  assert.equal(bridge.snapshot().respawnRecovery.actionRequests, 2);
  bridge.stop();
});


test('movement readiness retries exact missing subchunk sections without bypassing collision safety', () => {
  let now = 1000;
  const client = new Client();
  const movement = {
    capability() { return 'unavailable'; },
    snapshot() { return { unknownCells: [
      { x: 40, y: 70, z: -20, reason: 'block_not_observed' },
      { x: 41, y: 70, z: -19, reason: 'block_not_observed' },
      { x: 8, y: 64, z: 10, reason: 'collision_mapping_unavailable' }
    ] }; },
    stop() {}, stopPresence() {}
  };
  const bridge = new BedrockGameplayBridge(client, { movement, clock: () => now }).start();
  client.emit('start_game', { ...start, player_position: { x: 8.5, y: 64, z: 10.5 } });
  client.emit('spawn');
  client.sent.length = 0;

  assert.equal(bridge.snapshot().movement, 'unavailable',
    'unknown terrain must continue to block movement');
  let requests = client.sent.filter(item => item.packet === 'subchunk_request');
  assert.equal(requests.length, 1, 'request the exact section containing the unknown block');
  assert.deepEqual(requests[0].value.requests, [
    { x: 2, y: 0, z: -2 }
  ]);

  bridge.snapshot();
  assert.equal(client.sent.filter(item => item.packet === 'subchunk_request').length, 1,
    'repeated status snapshots must respect the per-section retry backoff');
  now += 15001;
  bridge.snapshot();
  assert.equal(client.sent.filter(item => item.packet === 'subchunk_request').length, 2,
    'a still-missing section can be retried after its bounded backoff');
  bridge.stop();
});

test('live control loop actively runs terrain preflight and exposes its status', () => {
  const client = new Client();
  const movement = {
    capability() { return 'unavailable'; },
    snapshot() { return { unknownCells: [
      { x: 40, y: 70, z: -20, reason: 'block_not_observed' }
    ] }; },
    stop() {}, stopPresence() {}
  };
  const bridge = new BedrockGameplayBridge(client, { movement }).start();
  client.emit('start_game', { ...start, player_position: { x: 8.5, y: 64, z: 10.5 } });
  client.emit('spawn');
  client.sent.length = 0;
  bridge.tickControlPlane();
  const requests = client.sent.filter(item => item.packet === 'subchunk_request');
  assert.equal(requests.length, 1, 'control loop requests missing terrain without waiting for UI polling');
  const status = bridge.snapshot().terrainCheck;
  assert.equal(status.ready, false);
  assert.equal(status.state, 'blocked', 'the request is not treated as proof that terrain arrived');
  assert.equal(status.reason, 'terrain_observation_incomplete');
  bridge.stop();
});
test('responsive IPC polling is decoupled from the slower gameplay safety loop', () => {
  const client = new Client();
  const intervals = [];
  const cleared = [];
  const bridge = new BedrockGameplayBridge(client, {
    commandPath: '/tmp/minepilot-command.json', receiptPath: '/tmp/minepilot-receipt.json',
    commandPollMs: 25, controlTickMs: 100,
    setInterval: (fn, ms) => { const handle = { fn, ms }; intervals.push(handle); return handle; },
    clearInterval: handle => cleared.push(handle)
  }).start();
  assert.deepEqual(intervals.map(item => item.ms), [25, 100]);
  assert.equal(bridge.commandPollMs, 25);
  assert.equal(bridge.controlTickMs, 100);
  bridge.stop();
  assert.equal(cleared.length, 2);
});

test('IPC polling interval is clamped to a safe range', () => {
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, { commandPollMs: 1, controlTickMs: 1 });
  assert.equal(bridge.commandPollMs, 10);
  assert.equal(bridge.controlTickMs, 50);
  bridge.stop();
});

test('manual input mailbox persists held intent until terrain is ready and clears on release or expiry', () => {
  const directory = mkdtempSync(join(tmpdir(), 'minepilot-manual-input-'));
  const manualInputPath = join(directory, 'manual-input-state.json');
  let now = 1000;
  let ready = false;
  let attempts = 0;
  let releases = 0;
  let applied = null;
  const movement = {
    capability: () => ready ? 'ready' : 'unavailable',
    releaseManual() { releases++; }
  };
  const bridge = new BedrockGameplayBridge(new Client(), {
    manualInputPath,
    movement,
    clock: () => now
  });
  bridge.execute = command => {
    attempts++;
    if (!ready) return { status: 'rejected', reason: 'terrain_not_fully_observed' };
    applied = command;
    return { status: 'accepted', reason: 'movement_controls_applied' };
  };
  const writeState = state => writeFileSync(manualInputPath, JSON.stringify(state));
  try {
    writeState({
      version: 'minepilot.manual-input.v1',
      requestId: 'hold-one',
      active: true,
      expiresAt: 2400,
      mode: 'vector',
      ticks: 8,
      motionX: 0.6,
      motionY: 0.2,
      jump: false,
      sprint: true,
      sneak: false
    });

    bridge.pollManualInput();
    assert.equal(bridge.snapshot().manualInput.status, 'waiting');
    assert.equal(bridge.snapshot().manualInput.reason, 'terrain_not_fully_observed');
    assert.equal(existsSync(manualInputPath), true, 'blocked input remains locally queued');
    bridge.pollManualInput();
    assert.equal(attempts, 1, 'do not spam the runtime while readiness remains blocked');

    ready = true;
    bridge.pollManualInput();
    assert.equal(attempts, 2, 'retry the same held input when readiness becomes available');
    assert.equal(applied?.motionX, 0.6);
    assert.equal(applied?.sprint, true);
    assert.equal(bridge.snapshot().manualInput.status, 'accepted');
    bridge.pollManualInput();
    assert.equal(attempts, 2, 'an accepted state is not replayed continuously');

    writeState({
      version: 'minepilot.manual-input.v1',
      requestId: 'release-one',
      active: false
    });
    bridge.pollManualInput();
    assert.equal(releases, 1);
    assert.equal(bridge.snapshot().manualInput.reason, 'manual_control_released');

    writeState({
      version: 'minepilot.manual-input.v1',
      requestId: 'hold-expired',
      active: true,
      expiresAt: 3000,
      mode: 'forward',
      ticks: 8,
      motionX: 0,
      motionY: 1
    });
    now = 4000;
    bridge.pollManualInput();
    assert.equal(releases, 2, 'expired held input actively releases the movement controller');
    assert.equal(bridge.snapshot().manualInput.status, 'expired');
  } finally {
    bridge.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});


test('movement presence retries after spawn when terrain was not ready on the first attempt', () => {
  let now = 1000;
  let ready = false;
  let active = false;
  let attempts = 0;
  const movement = {
    capability: () => active ? 'ready' : 'unavailable',
    snapshot: () => ({ presenceActive: active }),
    startPresence: () => {
      attempts++;
      if (!ready) return false;
      active = true;
      return true;
    },
    stop: () => {},
    stopPresence: () => {},
    resetSession: () => {}
  };
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, {
    movement, clock: () => now, terrainCheck: { check: () => ({ state: 'waiting' }) }
  });
  bridge.movementAuthority = 1;
  bridge.onSpawn();
  assert.equal(attempts, 1);
  assert.equal(bridge.snapshot().movementPresence.state, 'waiting');

  ready = true;
  now += 500;
  bridge.tickControlPlane();
  assert.equal(attempts, 2);
  assert.equal(bridge.snapshot().movementPresence.state, 'active');
  bridge.stop();
});


test('session diagnostics retain bounded packet and command summaries without raw identities', () => {
  const client = new Client();
  const bridge = new BedrockGameplayBridge(client, {
    movement: { capability() { return 'unavailable'; }, stop() {}, stopPresence() {},
      snapshot() { return { state: 'idle' }; } }
  }).start();
  client.emit('start_game', { ...start, player_position: { x: 8.5, y: 64, z: 10.5 },
    xuid: 'must-not-be-retained', gamertag: 'must-not-be-retained' });
  client.emit('spawn');
  client.emit('level_chunk', { x: 2, z: -3, dimension: 0, ownerXuid: 'private' });
  const result = bridge.execute({ version: 'minepilot.gameplay.v1',
    requestId: 'diagnostic-status', action: 'status' });
  assert.equal(result.status, 'ok');
  const snapshot = bridge.snapshot();
  assert.equal(snapshot.packetTelemetry.received >= 3, true);
  assert.equal(snapshot.packetTelemetry.byType.start_game, 1);
  assert.equal(snapshot.packetTelemetry.byType.spawn, 1);
  assert.equal(snapshot.packetTelemetry.byType.level_chunk, 1);
  assert.equal(snapshot.packetTelemetry.lastType, 'level_chunk');
  assert.deepEqual(snapshot.packetTelemetry.lastSummary, { x: 2, z: -3, dimension: 0 });
  assert.equal(JSON.stringify(snapshot).includes('must-not-be-retained'), false);
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
  assert.equal(snapshot.commandTelemetry.received, 1);
  assert.equal(snapshot.commandTelemetry.last.action, 'status');
  assert.equal(snapshot.commandTelemetry.last.status, 'ok');
  bridge.stop();
});


test('outbound Bedrock packets are counted and the original queue is restored on stop', () => {
  const client = new Client();
  const originalQueue = client.queue;
  const bridge = new BedrockGameplayBridge(client).start();
  client.queue('player_auth_input', {
    position: { x: 1, y: 64, z: 2 },
    move_vector: { x: 0, z: 1 },
    input_data: ['up', 'sprint'],
    input_mode: 'touch'
  });
  const telemetry = bridge.snapshot().packetTelemetry;
  assert.equal(telemetry.sentByType.player_auth_input, 1);
  assert.equal(telemetry.lastSentType, 'player_auth_input');
  assert.equal(telemetry.events.some(event =>
    event.direction === 'out' && event.type === 'player_auth_input'), true);
  assert.deepEqual(telemetry.lastSentSummary.position, { x: 1, y: 64, z: 2 });
  bridge.stop();
  assert.equal(client.queue, originalQueue);
});
