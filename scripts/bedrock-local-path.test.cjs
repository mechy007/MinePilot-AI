'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { planLocalRoute, octileDistance } = require('./bedrock-local-path.cjs');

function world(blocked = new Set(), unknown = new Set()) {
  return {
    tile(_dimension, x, y, z) {
      const key = x + ',' + z;
      if (unknown.has(key)) return 'unknown';
      if (blocked.has(key)) return 'blocked';
      return 'walkable';
    }
  };
}
const pos = (x, z, y = 65.62) => ({ x: x + 0.5, y, z: z + 0.5 });

test('A* uses a direct diagonal when both corner cells are verified clear', () => {
  const result = planLocalRoute(world(), 0, pos(0, 0), pos(3, 3));
  assert.equal(result.status, 'route_found');
  assert.equal(result.path.length, 4);
  assert.deepEqual(result.path.map(p => [p.x, p.z]), [
    [0.5, 0.5], [1.5, 1.5], [2.5, 2.5], [3.5, 3.5]
  ]);
  assert.ok(Math.abs(result.cost - 3 * Math.SQRT2) < 1e-9);
  assert.equal(result.executed, false);
});

test('A* will not cut diagonally through blocked corners', () => {
  const terrain = world(new Set(['1,0', '0,1']));
  const result = planLocalRoute(terrain, 0, pos(0, 0), pos(1, 1));
  assert.equal(result.status, 'route_found');
  assert.ok(result.path.length > 2);
  assert.notDeepEqual([result.path[1].x, result.path[1].z], [1.5, 1.5]);
});

test('unknown terrain blocks route proposals rather than becoming air', () => {
  const terrain = world(new Set(), new Set(['1,0', '0,1', '1,1']));
  const result = planLocalRoute(terrain, 0, pos(0, 0), pos(1, 1));
  assert.equal(result.status, 'unverified');
  assert.equal(result.reason, 'no_verified_route');
});

test('A* keeps the vertical-level safety boundary', () => {
  const result = planLocalRoute(world(), 0, pos(0, 0), pos(2, 0, 66.62));
  assert.equal(result.reason, 'different_vertical_level');
});

test('search and path budgets remain bounded', () => {
  const result = planLocalRoute(world(), 0, pos(0, 0), pos(12, 12), {
    radius: 24, maxExpanded: 16
  });
  assert.equal(result.status, 'unverified');
  assert.equal(result.reason, 'search_budget_exceeded');
  assert.ok(result.expanded <= 16);
});

test('octile heuristic matches straight and diagonal grid distances', () => {
  assert.equal(octileDistance(4, 0), 4);
  assert.ok(Math.abs(octileDistance(4, 4) - 4 * Math.SQRT2) < 1e-9);
});
