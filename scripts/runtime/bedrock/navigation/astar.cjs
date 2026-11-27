'use strict';

class MinHeap {
  constructor(compare) { this.items = []; this.compare = compare; }
  get size() { return this.items.length; }
  push(value) {
    const a = this.items;
    a.push(value);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(a[parent], value) <= 0) break;
      a[i] = a[parent]; i = parent;
    }
    a[i] = value;
  }
  pop() {
    const a = this.items;
    if (!a.length) return null;
    const first = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      while (true) {
        const left = i * 2 + 1, right = left + 1;
        if (left >= a.length) break;
        let child = left;
        if (right < a.length && this.compare(a[right], a[left]) < 0) child = right;
        if (this.compare(last, a[child]) <= 0) break;
        a[i] = a[child]; i = child;
      }
      a[i] = last;
    }
    return first;
  }
}

function octileDistance(dx, dz) {
  const diagonal = Math.min(dx, dz);
  return diagonal * Math.SQRT2 + Math.max(dx, dz) - diagonal;
}

function searchGridAStar({ start, target, isWalkable, radius = 9,
  maxExpanded = 1024, maxPathLength = 128 } = {}) {
  const failure = (reason, expanded = 0) => ({
    status: 'unverified', reason, path: [], expanded, cost: null
  });
  const valid = point => point && Number.isInteger(point.x) &&
    Number.isInteger(point.z) && Math.abs(point.x) <= 30000000 &&
    Math.abs(point.z) <= 30000000;
  if (!valid(start) || !valid(target) || typeof isWalkable !== 'function')
    return failure('invalid_grid_search_input');

  radius = Math.max(2, Math.min(24, Number.isFinite(radius) ? Math.floor(radius) : 9));
  maxExpanded = Math.max(1, Math.min(4096,
    Number.isFinite(maxExpanded) ? Math.floor(maxExpanded) : 1024));
  maxPathLength = Math.max(2, Math.min(256,
    Number.isFinite(maxPathLength) ? Math.floor(maxPathLength) : 128));

  const dx = Math.abs(start.x - target.x), dz = Math.abs(start.z - target.z);
  if (dx > radius || dz > radius) return failure('target_outside_verified_local_radius');
  if (!isWalkable(start.x, start.z) || !isWalkable(target.x, target.z))
    return failure('start_or_target_not_verified_walkable');

  const key = (x, z) => x + ',' + z;
  const startKey = key(start.x, start.z), targetKey = key(target.x, target.z);
  const heap = new MinHeap((a, b) =>
    (a.cost + a.estimate) - (b.cost + b.estimate) ||
    a.estimate - b.estimate || a.z - b.z || a.x - b.x);
  heap.push({ x: start.x, z: start.z, cost: 0,
    estimate: octileDistance(dx, dz) });
  const previous = new Map();
  const costs = new Map([[startKey, 0]]);
  const closed = new Set();
  const directions = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]
  ];
  let expanded = 0;

  while (heap.size && expanded < maxExpanded) {
    const current = heap.pop();
    const currentKey = key(current.x, current.z);
    if (closed.has(currentKey) || current.cost !== costs.get(currentKey)) continue;
    closed.add(currentKey);
    expanded++;

    if (currentKey === targetKey) {
      const path = [];
      let cursor = currentKey;
      while (cursor !== undefined) {
        const [x, z] = cursor.split(',').map(Number);
        path.push({ x, z });
        cursor = previous.get(cursor);
        if (path.length > maxPathLength) return failure('path_too_long', expanded);
      }
      path.reverse();
      return { status: 'found', reason: 'verified_bedrock_grid_with_diagonal_clearance',
        path, expanded, cost: current.cost };
    }

    for (const [moveX, moveZ, stepCost] of directions) {
      const x = current.x + moveX, z = current.z + moveZ;
      if (Math.abs(x - start.x) > radius || Math.abs(z - start.z) > radius) continue;
      if (!isWalkable(x, z)) continue;
      // Prevent squeezing diagonally between a blocked or unobserved corner.
      if (moveX !== 0 && moveZ !== 0 &&
          (!isWalkable(current.x + moveX, current.z) ||
           !isWalkable(current.x, current.z + moveZ))) continue;

      const nextKey = key(x, z);
      if (closed.has(nextKey)) continue;
      const nextCost = current.cost + stepCost;
      if (nextCost >= (costs.get(nextKey) ?? Infinity)) continue;
      costs.set(nextKey, nextCost);
      previous.set(nextKey, currentKey);
      heap.push({ x, z, cost: nextCost,
        estimate: octileDistance(Math.abs(x - target.x), Math.abs(z - target.z)) });
    }
  }

  return failure(expanded >= maxExpanded ? 'search_budget_exceeded' : 'no_verified_route', expanded);
}

module.exports = { MinHeap, searchGridAStar, octileDistance };
