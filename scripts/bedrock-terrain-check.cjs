'use strict';

/**
 * Active terrain preflight for Bedrock movement.
 *
 * Requests exact missing subchunk sections derived from the physics engine's
 * unknown block cells. Collision/registry uncertainty is not repairable by
 * downloading more terrain and therefore remains blocked.
 */
class BedrockTerrainCheck {
  constructor(options = {}) {
    this.maxCells = Number.isInteger(options.maxCells)
      ? Math.max(1, Math.min(32, options.maxCells)) : 8;
    this.snapshot = this.emptySnapshot('terrain_check_not_started');
  }

  emptySnapshot(reason) {
    return {
      state: 'waiting',
      ready: false,
      reason,
      unknownCells: 0,
      requestableCells: 0,
      unrequestableCells: 0,
      requestableSections: 0,
      columnsRequested: 0,
      subchunksRequested: 0,
      lastCheckedAt: null,
      lastRequestAt: null
    };
  }

  reset() {
    this.snapshot = this.emptySnapshot('new_world_session');
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
      Number.isFinite(cell.x) && Number.isFinite(cell.y) &&
      Number.isFinite(cell.z));
    const groups = new Map();

    for (const cell of requestable) {
      const x = Math.floor(cell.x / 16);
      const z = Math.floor(cell.z / 16);
      const sectionY = Math.floor(cell.y / 16);
      const key = x + ':' + z;
      let group = groups.get(key);
      if (!group) {
        group = { x, z, targetSections: new Set() };
        groups.set(key, group);
      }
      group.targetSections.add(sectionY);
    }

    const collisionReady = input.terrainSnapshot?.collisionClassificationReady === true;
    const hasRegistryFailure = unknownCells.some(cell =>
      cell?.reason === 'collision_mapping_unavailable');
    let reason = 'movement_controller_not_ready';
    if (capability === 'ready') reason = 'movement_preflight_ready';
    else if (!input.spawned || !position || !Number.isInteger(dimension))
      reason = 'world_position_or_dimension_unavailable';
    else if (requestable.length > 0) reason = 'terrain_observation_incomplete';
    else if (hasRegistryFailure || !collisionReady)
      reason = hasRegistryFailure ? 'collision_mapping_unavailable' : 'collision_classification_not_ready';
    else if (unknownCells.length > 0) reason = 'terrain_unknown_not_requestable';

    this.snapshot = {
      ...this.snapshot,
      ready: capability === 'ready',
      state: capability === 'ready' ? 'ready' : 'blocked',
      reason,
      unknownCells: unknownCells.length,
      requestableCells: requestable.length,
      unrequestableCells: unknownCells.length - requestable.length,
      requestableSections: [...groups.values()].reduce((sum, group) => sum + group.targetSections.size, 0),
      columnsRequested: 0,
      subchunksRequested: 0,
      lastCheckedAt: now
    };

    if (capability === 'ready' || !input.spawned || !position ||
        !Number.isInteger(dimension) || typeof input.requestSubchunks !== 'function') {
      return this.getSnapshot();
    }

    let columnsRequested = 0;
    let subchunksRequested = 0;
    for (const group of groups.values()) {
      const requested = input.requestSubchunks({
        x: group.x,
        z: group.z,
        dimension,
        targetSections: [...group.targetSections].sort((a, b) => a - b)
      });
      const count = Number.isInteger(requested) && requested > 0 ? requested
        : requested === true ? 1 : 0;
      if (count > 0) {
        columnsRequested++;
        subchunksRequested += count;
      }
    }

    this.snapshot = {
      ...this.snapshot,
      state: subchunksRequested > 0 ? 'requesting_terrain' : 'blocked',
      reason: subchunksRequested > 0 ? 'missing_subchunks_requested' : reason,
      columnsRequested,
      subchunksRequested,
      lastRequestAt: subchunksRequested > 0 ? now : this.snapshot.lastRequestAt
    };
    return this.getSnapshot();
  }

  getSnapshot() {
    return { ...this.snapshot };
  }
}

module.exports = { BedrockTerrainCheck };
