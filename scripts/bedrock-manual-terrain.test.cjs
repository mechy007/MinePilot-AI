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

function initialize(client, bridge) {
  client.emit('start_game', start);
  client.emit('spawn');
  client.emit('level_chunk', { x: 2, z: -2, dimension: 0 });
  client.sent.length = 0;
}

test('1.26.60 subchunk batches decode center-relative offsets and all-air entries', () => {
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
});

test('skeleton LevelChunk requests five nearby server subchunks and rate-limits repeats', () => {
  let now = 1000;
  const client = new FakeClient();
  const bridge = new BedrockGameplayBridge(client, { clock: () => now }).start();
  initialize(client, bridge);
  const header = { x: 2, z: -2, dimension: 0, sub_chunk_count: 0xffffffff };
  client.emit('level_chunk', header);
  const sent = client.sent.filter(item => item.packet === 'subchunk_request');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].value.dimension, 0);
  assert.deepEqual(sent[0].value.origin, { x: 2, y: 4, z: -2 });
  assert.deepEqual(sent[0].value.requests, [
    { x: 0, y: -2, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 2, z: 0 }
  ]);
  client.emit('level_chunk', header);
  assert.equal(client.sent.filter(item => item.packet === 'subchunk_request').length, 1);
  now += 15001;
  client.emit('level_chunk', header);
  assert.equal(client.sent.filter(item => item.packet === 'subchunk_request').length, 2);
  assert.equal(bridge.snapshot().subchunkRequestsSent, 2);
  bridge.stop();
});

test('manual directional controls send bounded camera-relative vectors and stop cleanly', () => {
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
    const wireVector = { x: vector.x, y: vector.z };
    assert.deepEqual(frame.move_vector, wireVector, mode);
    assert.deepEqual(frame.analogue_move_vector, wireVector, mode);
    assert.deepEqual(frame.raw_move_vector, wireVector, mode);
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
});

test('manual movement remains unavailable while another gameplay controller owns the bot', () => {
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
});


test('numeric vanilla registry requires the exact server_version and refuses hashed or custom palettes', () => {
  const { createVanillaRuntimeRegistry, clearRuntimeRegistryCache } =
    require('./bedrock-runtime-registry.cjs');
  clearRuntimeRegistryCache();
  const loader = () => ({
    blocks: [{ minStateId: 0, maxStateId: 1200, name: 'air', boundingBox: 'empty' }]
  });
  assert.equal(createVanillaRuntimeRegistry({}, loader), null,
    'missing server version cannot safely select a protocol palette');
  assert.equal(createVanillaRuntimeRegistry({ server_version: '1.26.51' }, loader), null);
  assert.equal(createVanillaRuntimeRegistry({
    server_version: '1.26.60.6', block_network_ids_are_hashes: true
  }, loader), null);
  assert.equal(createVanillaRuntimeRegistry({
    server_version: '1.26.60.6', block_properties: [{ name: 'addon:custom', states: {} }]
  }, loader), null);
  const map = createVanillaRuntimeRegistry({ server_version: '1.26.60.6' }, loader);
  assert.ok(map instanceof Map);
  assert.equal(map.get(0).name, 'minecraft:air');
  clearRuntimeRegistryCache();
});
