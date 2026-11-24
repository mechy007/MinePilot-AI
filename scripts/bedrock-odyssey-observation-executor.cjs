'use strict';

// Read-only executors for ODYSSEY primitives backed by live Bedrock observations.
// No packet writes, movement, block interaction, or inferred/unloaded terrain.
const MAX_POSITION_AGE_MS = 5000;
const MAX_INVENTORY_AGE_MS = 10000;
const finiteBlock = p => p && typeof p === 'object' &&
  ['x','y','z'].every(k => Number.isInteger(p[k]) && Math.abs(p[k]) <= 30000000);
const countMatching = (counts, pattern) => Object.entries(counts)
  .filter(([name]) => pattern.test(name))
  .reduce((sum, [, count]) => sum + count, 0);

function executeBedrockObservation(bridge, primitive, args = {}) {
  if (!bridge || bridge.closed) return { status: 'rejected', reason: 'session_closed', executable: false };
  if (!bridge.spawned || !bridge.position || bridge.dimension == null ||
      bridge.receivedChunks?.size < 1)
    return { status: 'rejected', reason: 'world_not_ready', executable: false };
  const positionAge = bridge.lastServerPositionAt == null ? Infinity :
    bridge.clock() - bridge.lastServerPositionAt;
  if (positionAge < 0 || positionAge > MAX_POSITION_AGE_MS)
    return { status: 'rejected', reason: 'server_position_stale', executable: false };

  const result = (value, observedAt, source) => ({
    status: 'ok', primitive, result: value, observedAt,
    verifiedBy: source, executed: false, readOnly: true
  });

  if (primitive === 'getLogsCount' || primitive === 'getPlanksCount') {
    const inventory = bridge.layerThree?.inventoryItems?.();
    if (!inventory?.known || !Number.isFinite(inventory.observedAt))
      return { status: 'rejected', reason: 'inventory_observation_unavailable', executable: false };
    const age = bridge.clock() - inventory.observedAt;
    if (age < 0 || age > MAX_INVENTORY_AGE_MS)
      return { status: 'rejected', reason: 'inventory_observation_stale', executable: false };
    const pattern = primitive === 'getLogsCount'
      ? /^minecraft:[a-z0-9_]+_(?:log|wood|stem|hyphae)$/
      : /^minecraft:[a-z0-9_]+_planks$/;
    return result(countMatching(inventory.counts, pattern), inventory.observedAt, 'server_inventory_content');
  }

  const terrain = bridge.terrain;
  if (!terrain || (terrain.snapshot?.().decodedSections ?? 0) < 1 ||
      (terrain.snapshot?.().registryEntries ?? 0) < 1)
    return { status: 'rejected', reason: 'decoded_terrain_registry_unavailable', executable: false };

  if (primitive === 'checkBlockAbove') {
    if (!finiteBlock(args.position)) return { status: 'rejected', reason: 'valid_block_position_required', executable: false };
    const p = { x: args.position.x, y: args.position.y + 1, z: args.position.z };
    const id = terrain.blockId(bridge.dimension, p.x, p.y, p.z);
    const name = terrain.blockName(bridge.dimension, p.x, p.y, p.z);
    if (id == null || !name) return { status: 'rejected', reason: 'block_not_observed', executable: false };
    return result({ position: p, runtimeId: id, name, kind: terrain.kind(bridge.dimension, p.x, p.y, p.z) },
      null, 'decoded_bedrock_terrain_cache');
  }

  if (primitive === 'checkBlocksAround' || primitive === 'findSuitablePosition') {
    const center = finiteBlock(args.position) ? args.position : {
      x: Math.floor(bridge.position.x), y: Math.floor(bridge.position.y), z: Math.floor(bridge.position.z)
    };
    const radius = primitive === 'findSuitablePosition' ? 3 : 2;
    const observations = [];
    for (let x = center.x - radius; x <= center.x + radius; x++) {
      for (let z = center.z - radius; z <= center.z + radius; z++) {
        for (let y = center.y - 1; y <= center.y + 2; y++) {
          const id = terrain.blockId(bridge.dimension, x, y, z);
          if (id == null) continue;
          observations.push({ position: { x, y, z }, runtimeId: id,
            name: terrain.blockName(bridge.dimension, x, y, z),
            kind: terrain.kind(bridge.dimension, x, y, z) });
          if (observations.length >= 256) break;
        }
        if (observations.length >= 256) break;
      }
      if (observations.length >= 256) break;
    }
    if (primitive === 'checkBlocksAround') {
      return result({ blocks: observations, unknownCellsOmitted: true }, bridge.lastWorldAt,
        'decoded_bedrock_subchunk_or_server_block_update');
    }
    const candidates = [];
    for (let x = center.x - radius; x <= center.x + radius; x++) {
      for (let z = center.z - radius; z <= center.z + radius; z++) {
        if (terrain.tile(bridge.dimension, x, center.y, z) === 'walkable')
          candidates.push({ x: x + 0.5, y: center.y, z: z + 0.5 });
      }
    }
    candidates.sort((a, b) =>
      Math.hypot(a.x - bridge.position.x, a.z - bridge.position.z) -
      Math.hypot(b.x - bridge.position.x, b.z - bridge.position.z));
    return result({ position: candidates[0] ?? null, candidates: candidates.length,
      unknownCellsTreatedAsUnsafe: true }, null, 'decoded_terrain_collision_registry');
  }

  return { status: 'rejected', reason: 'primitive_not_supported_by_observation_executor', executable: false };
}

module.exports = { executeBedrockObservation };
