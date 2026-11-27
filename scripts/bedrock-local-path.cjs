'use strict';

/** Compatibility facade: MinePilot terrain classification stays authoritative. */
const { searchGridAStar, octileDistance } = require('./runtime/bedrock/navigation/astar.cjs');

function tileIsSafe(terrain, dimension, x, y, z) {
  if (terrain.tile(dimension, x, y, z) !== 'walkable') return false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (terrain.tile(dimension, x + dx, y, z + dz) === 'hazard') return false;
  }
  return true;
}

function planLocalRoute(terrain, dimension, start, target, options = {}) {
  const failure = (reason, expanded = 0) => ({
    status: 'unverified', reason, waypoint: null, path: [], expanded,
    cost: null, executed: false
  });
  if (!terrain || ![dimension, start?.x, start?.y, start?.z,
    target?.x, target?.y, target?.z].every(Number.isFinite))
    return failure('invalid_position');
  if (!Number.isInteger(dimension) || ![0, 1, 2].includes(dimension))
    return failure('invalid_dimension');

  const y = Math.floor(start.y - 1.62 + 0.01);
  if (Math.floor(target.y - 1.62 + 0.01) !== y)
    return failure('different_vertical_level');

  const sx = Math.floor(start.x), sz = Math.floor(start.z);
  const tx = Math.floor(target.x), tz = Math.floor(target.z);
  const radius = Math.max(2, Math.min(24,
    Number.isFinite(options.radius) ? Math.floor(options.radius) : 9));
  if (Math.abs(sx - tx) > radius || Math.abs(sz - tz) > radius)
    return failure('target_outside_verified_local_radius');

  const search = searchGridAStar({
    start: { x: sx, z: sz }, target: { x: tx, z: tz }, radius,
    maxExpanded: options.maxExpanded ?? 1024,
    maxPathLength: options.maxPathLength ?? 128,
    isWalkable: (x, z) => tileIsSafe(terrain, dimension, x, y, z)
  });
  if (search.status !== 'found') return failure(search.reason, search.expanded);
  const path = search.path.map(point => ({
    x: point.x + 0.5, y: y + 1.62, z: point.z + 0.5
  }));
  return {
    status: 'route_found',
    reason: search.reason,
    waypoint: path[1] ?? path[0],
    path,
    expanded: search.expanded,
    cost: search.cost,
    executed: false
  };
}

module.exports = { planLocalRoute, tileIsSafe, octileDistance };
