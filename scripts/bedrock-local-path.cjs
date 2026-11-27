'use strict';

/**
 * Bounded A* for MinePilot's verified Bedrock terrain cache.
 *
 * Design adapted from studying Bedrock bot pathfinders (goal-based A*,
 * octile heuristic, bounded search, and explicit diagonal corner checks).
 * MinePilot-specific safety rules remain authoritative:
 * - only cache-confirmed walkable tiles may be traversed;
 * - unknown/partial collision shapes are never assumed safe;
 * - diagonal moves cannot cut through blocked or unknown corners;
 * - routes are proposals, never proof that movement was executed.
 */
function tileIsSafe(terrain, dim, x, y, z) {
  if (terrain.tile(dim, x, y, z) !== 'walkable') return false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (terrain.tile(dim, x + dx, y, z + dz) === 'hazard') return false;
  }
  return true;
}

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(value) {
    const a = this.items;
    a.push(value);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (compareNode(a[p], value) <= 0) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = value;
  }
  pop() {
    const a = this.items;
    if (!a.length) return null;
    const first = a[0];
    const last = a.pop();
    if (a.length) {
      let i = 0;
      while (true) {
        const left = i * 2 + 1;
        if (left >= a.length) break;
        const right = left + 1;
        let child = left;
        if (right < a.length && compareNode(a[right], a[left]) < 0) child = right;
        if (compareNode(last, a[child]) <= 0) break;
        a[i] = a[child];
        i = child;
      }
      a[i] = last;
    }
    return first;
  }
}

function compareNode(a, b) {
  return (a.cost + a.estimate) - (b.cost + b.estimate) ||
    a.estimate - b.estimate || a.z - b.z || a.x - b.x;
}

function octileDistance(dx, dz) {
  const diagonal = Math.min(dx, dz);
  return diagonal * Math.SQRT2 + (Math.max(dx, dz) - diagonal);
}

function planLocalRoute(terrain, dimension, start, target, options = {}) {
  const failure = (reason, expanded = 0) => ({
    status: 'unverified', reason, waypoint: null, path: [], expanded,
    cost: null, executed: false
  });
  if (!terrain || ![dimension, start?.x, start?.y, start?.z,
    target?.x, target?.y, target?.z].every(Number.isFinite)) {
    return failure('invalid_position');
  }
  if (!Number.isInteger(dimension) || ![0, 1, 2].includes(dimension))
    return failure('invalid_dimension');

  const y = Math.floor(start.y - 1.62 + 0.01);
  const targetY = Math.floor(target.y - 1.62 + 0.01);
  if (y !== targetY) return failure('different_vertical_level');

  const sx = Math.floor(start.x), sz = Math.floor(start.z);
  const tx = Math.floor(target.x), tz = Math.floor(target.z);
  const radius = Math.max(2, Math.min(24,
    Number.isFinite(options.radius) ? Math.floor(options.radius) : 9));
  const dx = Math.abs(sx - tx), dz = Math.abs(sz - tz);
  if (dx > radius || dz > radius)
    return failure('target_outside_verified_local_radius');

  const maxExpanded = Math.max(16, Math.min(4096,
    Number.isFinite(options.maxExpanded) ? Math.floor(options.maxExpanded) : 1024));
  const maxPathLength = Math.max(2, Math.min(256,
    Number.isFinite(options.maxPathLength) ? Math.floor(options.maxPathLength) : 128));
  if (!tileIsSafe(terrain, dimension, sx, y, sz) ||
      !tileIsSafe(terrain, dimension, tx, y, tz)) {
    return failure('start_or_target_not_verified_walkable');
  }

  const key = (x, z) => x + ',' + z;
  const startKey = key(sx, sz), targetKey = key(tx, tz);
  const frontier = new MinHeap();
  frontier.push({ x: sx, z: sz, cost: 0, estimate: octileDistance(dx, dz) });
  const previous = new Map();
  const costs = new Map([[startKey, 0]]);
  const closed = new Set();
  let expanded = 0;

  const directions = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]
  ];

  while (frontier.size && expanded < maxExpanded) {
    const current = frontier.pop();
    const at = key(current.x, current.z);
    if (closed.has(at) || current.cost !== costs.get(at)) continue;
    closed.add(at);
    expanded++;

    if (at === targetKey) {
      const path = [];
      let cursor = at;
      while (cursor !== undefined) {
        const [x, z] = cursor.split(',').map(Number);
        path.push({ x: x + 0.5, y: y + 1.62, z: z + 0.5 });
        cursor = previous.get(cursor);
        if (path.length > maxPathLength) return failure('path_too_long', expanded);
      }
      path.reverse();
      return {
        status: 'route_found',
        reason: 'verified_bedrock_grid_with_diagonal_clearance',
        waypoint: path[1] ?? path[0],
        path,
        expanded,
        cost: current.cost,
        executed: false
      };
    }

    for (const [mx, mz, stepCost] of directions) {
      const x = current.x + mx, z = current.z + mz;
      if (Math.abs(x - sx) > radius || Math.abs(z - sz) > radius) continue;
      if (!tileIsSafe(terrain, dimension, x, y, z)) continue;

      // A diagonal is legal only when both adjacent cardinal cells are safe.
      // This prevents squeezing through a blocked/unknown corner.
      if (mx !== 0 && mz !== 0 &&
          (!tileIsSafe(terrain, dimension, current.x + mx, y, current.z) ||
           !tileIsSafe(terrain, dimension, current.x, y, current.z + mz))) continue;

      const next = key(x, z);
      if (closed.has(next)) continue;
      const nextCost = current.cost + stepCost;
      if (nextCost >= (costs.get(next) ?? Infinity)) continue;
      costs.set(next, nextCost);
      previous.set(next, at);
      frontier.push({
        x, z, cost: nextCost,
        estimate: octileDistance(Math.abs(x - tx), Math.abs(z - tz))
      });
    }
  }

  return failure(expanded >= maxExpanded ? 'search_budget_exceeded' : 'no_verified_route', expanded);
}

module.exports = { planLocalRoute, tileIsSafe, octileDistance };
