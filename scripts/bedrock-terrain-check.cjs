'use strict';

/**
 * Active terrain preflight for Bedrock movement.
 *
 * This module never authorizes movement. It reports readiness from the
 * movement controller and asks the bridge to fetch only explicitly unknown
 * block cells. Collision/registry uncertainty remains blocked.
 */
class BedrockTerrainCheck {
  constructor(options = {}) {
    this.maxCells = Number.isInteger(options.maxCells)
      ? Math.max(1, Math.min(32, options.maxCells)) : 8;
    this.snapshot = {
      state: 'waiting',
      ready: false,
      reason: 'terrain_check_not_started',
      unknownCells: 0,
      requestableCells: 0,
      columnsRequested: 0,
      lastCheckedAt: null,
      lastRequestAt: null
    };
  }

  reset() {
    this.snapshot = {
      state: 'waiting',
      ready: false,
      reason: 'new_world_session',
      unknownCells: 0,
      requestableCells: 0,
      columnsRequested: 0,
      lastCheckedAt: null,
      lastRequestAt: null
    };
  }

  check(input = {}) {
    const now = Number.isFinite(input.now) ? input.now : Date.now();
    const position = input.position;
    const dimension = input.dimension;
    const movement = input.movementSnapshot;
    const capability = input.movementCapability ?? 'unavailable';
    const unknownCells = Array.isArray(movement?.unknownCells)
      ? movement.unknownCells.slice(0, this.maxCells) : [];
    const requestable = unknownCells.filter(cell =>
      cell && cell.reason === 'block_not_observed' &&
      Number.isFinite(cell.x) && Number.isFinite(cell.z));
    const columns = new Set(requestable.map(cell =>
      Math.floor(cell.x / 16) + ':' + Math.floor(cell.z / 16)));

    this.snapshot = {
      ...this.snapshot,
      ready: capability === 'ready',
      state: capability === 'ready' ? 'ready' : 'blocked',
      reason: capability === 'ready' ? 'movement_preflight_ready' :
        !input.spawned || !position || !Number.isInteger(dimension)
          ? 'world_position_or_dimension_unavailable'
          : unknownCells.length > 0 ? 'terrain_observation_incomplete'
            : input.terrainSnapshot?.collisionClassificationReady !== true
              ? 'collision_classification_not_ready'
              : 'movement_controller_not_ready',
      unknownCells: unknownCells.length,
      requestableCells: requestable.length,
      columnsRequested: 0,
      lastCheckedAt: now
    };

    if (capability === 'ready' || !input.spawned || !position ||
        !Number.isInteger(dimension) || typeof input.requestSubchunks !== 'function') {
      return this.getSnapshot();
    }

    let requested = 0;
    for (const key of columns) {
      const [x, z] = key.split(':').map(Number);
      if (input.requestSubchunks({ x, z, dimension, sub_chunk_count: 0xffffffff })) {
        requested++;
      }
    }
    this.snapshot = {
      ...this.snapshot,
      state: requested > 0 ? 'requesting_terrain' : 'blocked',
      reason: requested > 0 ? 'missing_terrain_requested' : this.snapshot.reason,
      columnsRequested: requested,
      lastRequestAt: requested > 0 ? now : this.snapshot.lastRequestAt
    };
    return this.getSnapshot();
  }

  getSnapshot() {
    return { ...this.snapshot };
  }
}

module.exports = { BedrockTerrainCheck };
