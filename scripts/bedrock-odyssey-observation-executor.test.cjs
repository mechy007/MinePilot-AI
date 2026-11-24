'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { executeBedrockObservation } = require('./bedrock-odyssey-observation-executor.cjs');

function bridge(overrides = {}) {
  const now = 10000;
  return {
    closed: false, spawned: true, position: { x: 0.5, y: 64, z: 0.5 }, dimension: 0,
    receivedChunks: new Map([['0:0:0', now]]), lastServerPositionAt: now, lastWorldAt: now,
    clock: () => now,
    layerThree: { inventoryItems: () => ({ known: true, observedAt: now, counts: {
      'minecraft:oak_log': 4, 'minecraft:stripped_oak_log': 2,
      'minecraft:oak_planks': 12, 'minecraft:birch_planks': 3
    } }) },
    terrain: {
      snapshot: () => ({ decodedSections: 1, registryEntries: 3 }),
      blockId: (_d,x,y,z) => x === 0 && y === 64 && z === 0 ? 7 : null,
      blockName: (_d,x,y,z) => x === 0 && y === 64 && z === 0 ? 'minecraft:stone' : null,
      kind: (_d,x,y,z) => x === 0 && y === 64 && z === 0 ? 'solid' : null,
      tile: (_d,x,y,z) => x === 1 && y === 64 && z === 0 ? 'walkable' : 'unknown'
    },
    ...overrides
  };
}

test('counts logs and planks from a fresh server inventory snapshot only', () => {
  const b = bridge();
  assert.equal(executeBedrockObservation(b, 'getLogsCount').result, 6);
  assert.equal(executeBedrockObservation(b, 'getPlanksCount').result, 15);
  assert.equal(executeBedrockObservation(b, 'getLogsCount').verifiedBy, 'server_inventory_content');
});

test('rejects missing, stale, and unknown inventory instead of returning zero', () => {
  assert.equal(executeBedrockObservation(bridge({ layerThree: null }), 'getLogsCount').reason,
    'inventory_observation_unavailable');
  assert.equal(executeBedrockObservation(bridge({ lastServerPositionAt: 1 }), 'getLogsCount').reason,
    'server_position_stale');
  const b = bridge({ layerThree: { inventoryItems: () => ({ known: true, observedAt: 1, counts: {} }) } });
  assert.equal(executeBedrockObservation(b, 'getLogsCount').reason, 'inventory_observation_stale');
});

test('block observation never invents unknown cells or writes gameplay packets', () => {
  const b = bridge();
  const above = executeBedrockObservation(b, 'checkBlockAbove', { position: { x: 0, y: 63, z: 0 } });
  assert.equal(above.result.name, 'minecraft:stone');
  assert.equal(above.observedAt, null);
  const nearby = executeBedrockObservation(b, 'checkBlocksAround');
  assert.equal(nearby.result.blocks.length, 1);
  assert.equal(nearby.result.unknownCellsOmitted, true);
  const safe = executeBedrockObservation(b, 'findSuitablePosition');
  assert.deepEqual(safe.result.position, { x: 1.5, y: 64, z: 0.5 });
  assert.equal(safe.result.unknownCellsTreatedAsUnsafe, true);
});

test('terrain primitives fail closed without decoded sections and registry', () => {
  const b = bridge({ terrain: { snapshot: () => ({ decodedSections: 0, registryEntries: 0 }) } });
  assert.equal(executeBedrockObservation(b, 'checkBlocksAround').reason,
    'decoded_terrain_registry_unavailable');
});
