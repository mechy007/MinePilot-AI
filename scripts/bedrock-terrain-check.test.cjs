'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BedrockTerrainCheck } = require('./bedrock-terrain-check.cjs');

test('terrain preflight requests only observed-missing block columns and stays fail-closed', () => {
  const requests = [];
  const check = new BedrockTerrainCheck();
  const input = {
    now: 1000, spawned: true, position: { x: 8.5, y: 64, z: 10.5 }, dimension: 0,
    movementCapability: 'unavailable',
    movementSnapshot: { unknownCells: [
      { x: 40, y: 70, z: -20, reason: 'block_not_observed' },
      { x: 41, y: 70, z: -19, reason: 'block_not_observed' },
      { x: 8, y: 64, z: 10, reason: 'collision_mapping_unavailable' }
    ] },
    terrainSnapshot: { collisionClassificationReady: false },
    requestSubchunks: request => { requests.push(request); return true; }
  };
  const result = check.check(input);
  assert.equal(result.state, 'requesting_terrain');
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'missing_terrain_requested');
  assert.equal(result.unknownCells, 3);
  assert.equal(result.requestableCells, 2);
  assert.equal(requests.length, 1, 'nearby missing blocks in one chunk share a request');
  assert.deepEqual(requests[0], { x: 2, z: -2, dimension: 0, sub_chunk_count: 0xffffffff });
  assert.equal(check.check({ ...input, movementCapability: 'ready' }).ready, true);
});

test('terrain preflight does not request data without a live position or for registry uncertainty', () => {
  const requests = [];
  const check = new BedrockTerrainCheck();
  const base = {
    spawned: true, position: { x: 8.5, y: 64, z: 10.5 }, dimension: 0,
    movementCapability: 'unavailable',
    movementSnapshot: { unknownCells: [
      { x: 8, y: 64, z: 10, reason: 'collision_mapping_unavailable' }
    ] },
    terrainSnapshot: { collisionClassificationReady: false },
    requestSubchunks: request => { requests.push(request); return true; }
  };
  const blocked = check.check({ ...base, spawned: false });
  assert.equal(blocked.ready, false);
  assert.equal(requests.length, 0);
  const registryBlocked = check.check(base);
  assert.equal(registryBlocked.state, 'blocked');
  assert.equal(requests.length, 0);
});

test('terrain preflight caps inspected unknown cells and resets between worlds', () => {
  const requests = [];
  const check = new BedrockTerrainCheck({ maxCells: 2 });
  const result = check.check({
    spawned: true, position: { x: 0, y: 64, z: 0 }, dimension: 0,
    movementCapability: 'unavailable',
    movementSnapshot: { unknownCells: [
      { x: 0, z: 0, reason: 'block_not_observed' },
      { x: 32, z: 0, reason: 'block_not_observed' },
      { x: 64, z: 0, reason: 'block_not_observed' }
    ] },
    requestSubchunks: request => { requests.push(request); return true; }
  });
  assert.equal(result.unknownCells, 2);
  assert.equal(requests.length, 2);
  check.reset();
  assert.equal(check.getSnapshot().reason, 'new_world_session');
});