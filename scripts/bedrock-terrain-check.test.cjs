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
  assert.equal(result.reason, 'missing_subchunks_requested');
  assert.equal(result.unknownCells, 3);
  assert.equal(result.requestableCells, 2);
  assert.equal(result.requestableSections, 1);
  assert.equal(result.subchunksRequested, 1);
  assert.equal(requests.length, 1, 'nearby missing blocks in one chunk and section share a request');
  assert.deepEqual(requests[0], { x: 2, z: -2, dimension: 0, targetSections: [4] });
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
      { x: 0, y: 64, z: 0, reason: 'block_not_observed' },
      { x: 32, y: 80, z: 0, reason: 'block_not_observed' },
      { x: 64, y: 64, z: 0, reason: 'block_not_observed' }
    ] },
    requestSubchunks: request => { requests.push(request); return true; }
  });
  assert.equal(result.unknownCells, 2);
  assert.equal(requests.length, 2);
  check.reset();
  assert.equal(check.getSnapshot().reason, 'new_world_session');
});

test('terrain preflight preserves exact vertical sections for recovery requests', () => {
  const requests = [];
  const check = new BedrockTerrainCheck();
  const result = check.check({
    now: 2000, spawned: true, position: { x: 8, y: 64, z: 8 }, dimension: 0,
    movementCapability: 'unavailable',
    movementSnapshot: { unknownCells: [
      { x: 8, y: 130, z: 8, reason: 'block_not_observed' },
      { x: 9, y: 130, z: 9, reason: 'block_not_observed' },
      { x: 9, y: 145, z: 9, reason: 'block_not_observed' }
    ] },
    terrainSnapshot: { collisionClassificationReady: true },
    requestSubchunks: request => { requests.push(request); return request.targetSections.length; }
  });
  assert.equal(result.requestableSections, 2);
  assert.equal(result.subchunksRequested, 2);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    x: 0, z: 0, dimension: 0, targetSections: [8, 9]
  });
});

test('terrain preflight distinguishes collision registry failures from missing terrain', () => {
  const check = new BedrockTerrainCheck();
  const result = check.check({
    spawned: true, position: { x: 0, y: 64, z: 0 }, dimension: 0,
    movementCapability: 'unavailable',
    movementSnapshot: { unknownCells: [
      { x: 0, y: 64, z: 0, reason: 'collision_mapping_unavailable' }
    ] },
    terrainSnapshot: { collisionClassificationReady: false },
    requestSubchunks: () => { throw new Error('collision gaps must not trigger terrain requests'); }
  });
  assert.equal(result.state, 'blocked');
  assert.equal(result.reason, 'collision_mapping_unavailable');
  assert.equal(result.requestableCells, 0);
  assert.equal(result.unrequestableCells, 1);
});


test('terrain recovery reads unknown cells from the movement controller terrain snapshot', () => {
  const requests = [];
  const check = new BedrockTerrainCheck();
  const result = check.check({
    now: 3000, spawned: true, position: { x: 8.5, y: 65.62, z: 10.5 }, dimension: 0,
    movementCapability: 'unavailable',
    movementSnapshot: { terrain: { unknown: true, unknownCells: [
      { x: 17, y: 64, z: -1, reason: 'block_not_observed' }
    ] } },
    terrainSnapshot: { collisionClassificationReady: true },
    requestSubchunks: request => { requests.push(request); return 1; }
  });
  assert.equal(result.state, 'requesting_terrain');
  assert.equal(result.requestableCells, 1);
  assert.equal(result.subchunksRequested, 1);
  assert.deepEqual(requests, [{
    x: 1, z: -1, dimension: 0, targetSections: [4]
  }]);
});
