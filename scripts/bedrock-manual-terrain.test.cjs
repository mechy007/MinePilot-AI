'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { BedrockGameplayBridge } = require('./bedrock-gameplay-bridge.cjs');
const { ExperimentalPlayerInput } = require('./bedrock-player-input.cjs');
const { BedrockTerrainCache } = require('./bedrock-terrain-cache.cjs');

class FakeClient extends EventEmitter {
  sent = [];
  queue(packet, value) { this.sent.push({ packet, value }); }
}

const start = {
  runtime_entity_id: 123n,
  player_position: { x: 33.25, y: 70.5, z: -17.75 },
  dimension: 0,
  current_tick: 100n,
  movement_authority: 1
};

console.error('[manual-terrain-test] file loaded');

function initialize(client, bridge) {
  client.emit('start_game', start);
  client.emit('spawn');
  client.emit('level_chunk', { x: 2, z: -2, dimension: 0 });
  client.sent.length = 0;
}

test('1.26.60 subchunk batches decode center-relative offsets and all-air entries', () => {
  console.error('[manual-terrain-test:1] 1.26.60 subchunk batches decode center-relative offsets and all-air entries');
  const terrain = new BedrockTerrainCache();
  terrain.reset(0);
  terrain.setRegistry(new Map([[0, { name: 'minecraft:air', boundingBox: 'empty' }]]));
  const decoded = terrain.subChunk({
    dimension: 0,
    center: { x: 3, y: 4, z: 2 },
    entries: [
      { sub_chunk_pos_offset: { x: 1, y: 1, z: 1 }, result: 1,
        payload: Buffer.from([9, 1, 5, 1, 1, 0]) },
      { sub_chunk_pos_offset: { x: 0, y: 2, z: 0 }, result: 6 }
    ]
  });
  assert.equal(decoded, 2);
  assert.equal(terrain.snapshot().decodedSections, 2);
  assert.equal(terrain.blockName(0, 64, 80, 48), 'minecraft:air');
  console.error('[manual-terrain-test:1] done');
});

test('skeleton LevelChunk requests five nearby server subchunks and rate-limits repeats', () => {
  console.error('[manual-terrain-test:2] skeleton LevelChunk requests five nearby server subchunks and rate-limits repeats');
  let now = 1000;
  const client = new FakeClient();
  const bridge = new BedrockGameplayBridge(client, { clock: () => now }).start();
  initialize(client, bridge);
  const header = { x: 4, z: -1, dimension: 0, sub_chunk_count: 0xffffffff };
  client.emit('level_chunk', header);
  const sent = client.sent.filter(item => item.packet === 'subchunk_request');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].value.dimension, 0);
  assert.deepEqual(sent[0].value.origin, { x: 2, y: 4, z: -2 });
  assert.deepEqual(sent[0].value.requests, [
    { x: 2, y: -2, z: 1 },
    { x: 2, y: -1, z: 1 },
    { x: 2, y: 0, z: 1 },
    { x: 2, y: 1, z: 1 },
    { x: 2, y: 2, z: 1 }
  ]);
  client.emit('level_chunk', header);
  assert.equal(client.sent.filter(item => item.packet === 'subchunk_request').length, 1);
  now += 15001;
  client.emit('level_chunk', header);
  assert.equal(client.sent.filter(item => item.packet === 'subchunk_request').length, 2);
  assert.equal(bridge.snapshot().subchunkRequestsSent, 2);
  bridge.stop();
  console.error('[manual-terrain-test:2] done');
});

test('manual directional controls send bounded camera-relative vectors and stop cleanly', () => {
  console.error('[manual-terrain-test:3] manual directional controls send bounded camera-relative vectors and stop cleanly');
  let now = 1000;
  let pulse = null;
  const client = new FakeClient();
  const movement = new ExperimentalPlayerInput(client, true, {
    clock: () => now,
    setInterval: callback => { pulse = callback; return 1; },
    clearInterval: () => {}
  });
  const bridge = new BedrockGameplayBridge(client, { movement, clock: () => now }).start();
  initialize(client, bridge);
  const cases = [
    ['forward', { x: 0, z: 1 }, 10],
    ['backward', { x: 0, z: -1 }, 11],
    ['strafe_left', { x: -1, z: 0 }, 12],
    ['strafe_right', { x: 1, z: 0 }, 13]
  ];
  for (const [mode, vector, flag] of cases) {
    now += 50;
    const result = bridge.execute({
      version: 'minepilot.gameplay.v1', requestId: mode,
      action: 'manual_move', confirmed: true, mode, ticks: 2
    });
    assert.equal(result.status, 'accepted', mode);
    pulse();
    const frame = client.sent.at(-1).value;
    assert.deepEqual(frame.move_vector, vector, mode);
    assert.deepEqual(frame.analogue_move_vector, vector, mode);
    assert.deepEqual(frame.raw_move_vector, vector, mode);
    assert.deepEqual(frame.input_data, [flag], mode);
    const stopped = bridge.execute({
      version: 'minepilot.gameplay.v1', requestId: mode + '-stop',
      action: 'manual_stop'
    });
    assert.equal(stopped.status, 'ok');
    assert.equal(movement.snapshot().active, false);
    initialize(client, bridge);
  }
  bridge.stop();
  console.error('[manual-terrain-test:3] done');
});

test('manual hold preserves one predicted position across direction changes and stops on watchdog expiry', () => {
  console.error('[manual-terrain-test:4] manual hold preserves one predicted position across direction changes and stops on watchdog expiry');
  let now = 1000;
  let pulse = null;
  const client = new FakeClient();
  const movement = new ExperimentalPlayerInput(client, true, {
    clock: () => now,
    setInterval: callback => { pulse = callback; return 1; },
    clearInterval: () => {}
  });
  const bridge = new BedrockGameplayBridge(client, { movement, clock: () => now }).start();
  initialize(client, bridge);

  const move = (requestId, mode) => bridge.execute({
    version: 'minepilot.gameplay.v1', requestId,
    action: 'manual_move', confirmed: true, mode, ticks: 8
  });
  const started = move('manual-hold-forward', 'forward');
  assert.equal(started.status, 'accepted');
  assert.equal(movement.manualHoldActive, true);
  pulse();
  const firstFrame = client.sent.at(-1).value;
  assert.deepEqual(firstFrame.move_vector, { x: 0, z: 1 });

  now += 450;
  const changed = move('manual-hold-right', 'strafe_right');
  assert.equal(changed.status, 'accepted');
  assert.equal(movement.snapshot().active, true,
    'direction changes must not create a new movement timer');
  pulse();
  const secondFrame = client.sent.at(-1).value;
  assert.deepEqual(secondFrame.move_vector, { x: 1, z: 0 });
  assert.notDeepEqual(secondFrame.position, start.player_position,
    'the next direction must continue from the previous predicted position');
  assert.notDeepEqual(secondFrame.position, firstFrame.position);

  const predictedBeforeRelease = { ...movement.predicted };
  const stopped = bridge.execute({
    version: 'minepilot.gameplay.v1', requestId: 'manual-hold-stop',
    action: 'manual_stop'
  });
  assert.equal(stopped.status, 'ok');
  assert.equal(movement.snapshot().active, false);
  assert.deepEqual(client.sent.at(-1).value.position, predictedBeforeRelease,
    'neutral release must not rewind to a stale spawn anchor');

  const resumed = move('manual-hold-back', 'backward');
  assert.equal(resumed.status, 'accepted');
  pulse();
  const resumedFrame = client.sent.at(-1).value;
  assert.deepEqual(resumedFrame.move_vector, { x: 0, z: -1 });
  assert.equal(resumedFrame.position.x, predictedBeforeRelease.x,
    'a new hold in the same session should resume from the saved manual anchor');
  assert.notEqual(resumedFrame.position.x, start.player_position.x);

  bridge.execute({
    version: 'minepilot.gameplay.v1', requestId: 'manual-hold-stop-again',
    action: 'manual_stop'
  });
  initialize(client, bridge);
  const watchdog = move('manual-watchdog', 'forward');
  assert.equal(watchdog.status, 'accepted');
  pulse();
  now += 1200;
  pulse();
  assert.equal(movement.snapshot().active, false);
  assert.equal(movement.snapshot().stoppedReason, 'manual_input_timeout');
  bridge.stop();
  console.error('[manual-terrain-test:4] done');
});

test('manual movement remains unavailable while another gameplay controller owns the bot', () => {
  console.error('[manual-terrain-test:5] manual movement remains unavailable while another gameplay controller owns the bot');
  const client = new FakeClient();
  const movement = new ExperimentalPlayerInput(client, true);
  const bridge = new BedrockGameplayBridge(client, {
    movement,
    gameplayAgent: { snapshot: () => ({ active: true }), stop() {} }
  }).start();
  initialize(client, bridge);
  const result = bridge.execute({
    version: 'minepilot.gameplay.v1', requestId: 'manual-busy',
    action: 'manual_move', confirmed: true, mode: 'forward', ticks: 4
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'autonomous_controller_busy');
  bridge.stop();
  console.error('[manual-terrain-test:5] done');
});


test('hashed Bedrock 1.26.60+ worlds resolve captured vanilla block-state hashes', () => {
  console.error('[manual-terrain-test:6] hashed Bedrock 1.26.60+ worlds resolve captured vanilla block-state hashes');
  const { createVanillaRuntimeRegistry, clearRuntimeRegistryCache } =
    require('./bedrock-runtime-registry.cjs');
  clearRuntimeRegistryCache();
  const hashed = createVanillaRuntimeRegistry({
    server_version: '1.26.66.1',
    block_network_ids_are_hashes: true,
    block_properties: [{ name: 'addon:custom_block', states: {} }]
  });
  assert.ok(hashed instanceof Map);
  assert.equal(hashed.size, 23948);
  assert.deepEqual(hashed.get((-2144268767) >>> 0), {
    name: 'minecraft:stone', boundingBox: 'block', fullCube: true
  });
  assert.deepEqual(hashed.get((-604749536) >>> 0), {
    name: 'minecraft:air', boundingBox: 'empty', fullCube: false
  });
  assert.equal(hashed.get(203547508).name, 'minecraft:brown_mushroom_block');
  assert.equal(hashed.get(1659726445).name, 'minecraft:pointed_dripstone');
  assert.deepEqual(hashed.get(2879325999), {
    name: 'minecraft:oak_stairs', boundingBox: 'block', fullCube: false
  }, 'partial stair collision is not a full cube');
  assert.equal(hashed.get(123456789), undefined,
    'unknown add-on hashes never receive an invented block identity');

  // Subchunk palettes carry hashed runtime IDs as unsigned varuint32 values,
  // although FNV-1a itself is represented as a signed int32 in the hash code.
  const stoneWireId = (-2144268767) >>> 0;
  const encodedVarUint = value => {
    const bytes = [];
    let remaining = value >>> 0;
    while (remaining >= 0x80) {
      bytes.push((remaining & 0x7f) | 0x80);
      remaining >>>= 7;
    }
    bytes.push(remaining);
    return bytes;
  };
  const { parseStorage } = require('./bedrock-terrain-cache.cjs');
  const storage = Buffer.from([1, 1, ...encodedVarUint(stoneWireId)]);
  const decodedStorage = parseStorage(storage, { offset: 0 });
  assert.equal(decodedStorage[0], stoneWireId);

  const decodedTerrain = new BedrockTerrainCache();
  decodedTerrain.reset(0);
  assert.equal(decodedTerrain.setRegistry(hashed), true);
  const sectionPayload = Buffer.from([
    9, 1, 4, // version 9, one storage layer, section Y = 4
    ...storage
  ]);
  assert.equal(decodedTerrain.subChunk({
    dimension: 0,
    origin: { x: 0, y: 4, z: 0 },
    entries: [{ dx: 0, dy: 0, dz: 0, result: 'success', payload: sectionPayload }]
  }), 1);
  assert.equal(decodedTerrain.blockName(0, 0, 64, 0), 'minecraft:stone');
  assert.equal(decodedTerrain.kind(0, 0, 64, 0), 'solid');
  assert.equal(decodedTerrain.tile(0, 0, 65, 0), 'blocked');

  const stairsTerrain = new BedrockTerrainCache();
  stairsTerrain.reset(0);
  stairsTerrain.setRegistry(hashed);
  stairsTerrain.store(0, 0, 0, 4, new Uint32Array(4096).fill(2879325999));
  assert.equal(stairsTerrain.kind(0, 0, 64, 0), null,
    'partial collision shapes must not be treated as full block supports');

  const partialTerrain = new BedrockTerrainCache();
  partialTerrain.reset(0);
  partialTerrain.setRegistry(hashed);
  partialTerrain.store(0, 0, 0, 4, new Uint32Array(4096).fill(123456789));
  assert.equal(partialTerrain.tile(0, 0, 64, 0), 'unknown',
    'unmapped custom block hashes remain collision-unknown');

  assert.equal(createVanillaRuntimeRegistry({
    server_version: '1.26.51.0', block_network_ids_are_hashes: true
  }), null, 'unsupported protocol families cannot select the 2225 palette');
  clearRuntimeRegistryCache();
  console.error('[manual-terrain-test:6] done');
});

test('numeric palette is exact-version only and fails closed on custom block registration', () => {
  console.error('[manual-terrain-test:7] numeric palette is exact-version only and fails closed on custom block registration');
  const { createVanillaRuntimeRegistry, clearRuntimeRegistryCache } =
    require('./bedrock-runtime-registry.cjs');
  clearRuntimeRegistryCache();
  const loader = () => ({
    blocks: [{ minStateId: 0, maxStateId: 1200, name: 'air', boundingBox: 'empty' }]
  });
  assert.equal(createVanillaRuntimeRegistry({}, loader), null,
    'missing server version cannot safely select a protocol palette');
  assert.equal(createVanillaRuntimeRegistry({ server_version: '1.26.66.1' }, loader), null,
    'captured numeric IDs cannot be reused on another release');
  assert.equal(createVanillaRuntimeRegistry({
    server_version: '1.26.60.6', block_network_ids_are_hashes: true
  }, loader), null);

  const customWorld = createVanillaRuntimeRegistry({
    server_version: '1.26.60.6',
    block_properties: [{ name: 'addon:custom', states: {} }]
  });
  assert.equal(customWorld, null,
    'production custom blocks may renumber a non-hashed runtime palette');

  const map = createVanillaRuntimeRegistry({ server_version: '1.26.60.6' }, loader);
  assert.ok(map instanceof Map);
  assert.equal(map.get(0).name, 'minecraft:air');
  clearRuntimeRegistryCache();
  console.error('[manual-terrain-test:7] done');
});
