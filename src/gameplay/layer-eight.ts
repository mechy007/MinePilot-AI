/**
 * Layer 8 — consolidated beta readiness and command freshness.
 *
 * A green CI check or a serialized packet is not a physical Minecraft action.
 * Physical-host verification is NOT recorded by the Android runtime: all
 * action-capability blockers remain until an independently verified release.
 */
export type RuntimeEvidence = Readonly<{
  spawned: boolean;
  hasSelfEntity: boolean;
  hasPosition: boolean;
  positionAgeMs: number | null;
  /** True only while the session's original server position remains a safe idle anchor. */
  idlePositionAnchor?: boolean;
  /** Explicit false invalidates even a numerically recent timestamp after input. */
  positionUsable?: boolean;
  receivedChunkHeaders: number;
  movementAuthority: number | null;
  blocksDecoded: boolean;
  movementCorrections: number;
  sessionClosed: boolean;
}>;
export type ReadinessSnapshot = Readonly<{
  stage: 'disconnected' | 'awaiting_world' | 'observing' | 'planning_preview';
  commandEligible: boolean;
  commandReason: string;
  releaseReady: false;
  autonomousGameplayReady: false;
  liveWalkVerified: false;
  terrainVerified: false;
  actionsVerified: false;
  blockers: string[];
  observed: {
    entity: boolean; coordinates: boolean; chunkHeaders: number;
    corrections: number; positionAgeMs: number | null;
    positionMode: 'server_fresh' | 'idle_spawn_anchor' | 'stale';
  };
}>;
const MAX_AGE_MS = 30_000;
const MAX_CHUNKS = 128;
const integer = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;

export class LayerEightReadiness {
  assess(data: RuntimeEvidence): ReadinessSnapshot {
    const age = data.positionAgeMs;
    const validNumericAge = age !== null && Number.isFinite(age) && age >= 0 &&
      age <= MAX_AGE_MS;
    const recentAge = data.positionUsable !== false && validNumericAge && age <= 7000;
    const idleAnchor = data.positionUsable === true &&
      data.idlePositionAnchor === true && validNumericAge;
    const positionMode: ReadinessSnapshot['observed']['positionMode'] =
      recentAge ? 'server_fresh' : idleAnchor ? 'idle_spawn_anchor' : 'stale';
    const validAge = recentAge || idleAnchor;
    const validHeaders = integer(data.receivedChunkHeaders) &&
      data.receivedChunkHeaders >= 1 && data.receivedChunkHeaders <= MAX_CHUNKS;
    const observed = {
      entity: !!data.hasSelfEntity, coordinates: !!data.hasPosition,
      chunkHeaders: integer(data.receivedChunkHeaders) ?
        Math.min(MAX_CHUNKS, data.receivedChunkHeaders) : 0,
      corrections: integer(data.movementCorrections) ?
        Math.min(1000000,data.movementCorrections) : 0,
      positionAgeMs: age !== null && Number.isFinite(age) && age >= 0 ? Math.round(age) : null,
      positionMode
    };
    const ready = !!data.spawned && !!data.hasSelfEntity && !!data.hasPosition &&
      validHeaders && validAge && !data.sessionClosed;
    const reason = data.sessionClosed ? 'connection_closed' :
      !data.spawned || !data.hasSelfEntity ? 'not_spawned' :
      !data.hasPosition ? 'position_unknown' :
      !validHeaders ? 'world_chunks_unavailable' :
      !validAge ? 'server_position_stale' :
      idleAnchor && !recentAge ? 'idle_spawn_anchor' : 'bounded_planning_only';
    const stage: ReadinessSnapshot['stage'] = data.sessionClosed ? 'disconnected' :
      !data.spawned || !data.hasSelfEntity ? 'awaiting_world' :
      !ready ? 'observing' : 'planning_preview';
    // These blockers may NOT be removed by toggling an Android UI switch.
    const blockers = [
      'host_verified_movement_missing',
      'decoded_collision_voxels_missing',
      'server_confirmed_block_and_item_actions_missing',
      'on_device_background_and_disconnection_qa_missing'
    ];
    if (!ready) blockers.unshift(reason);
    return {
      stage, commandEligible: ready, commandReason: reason,
      releaseReady: false, autonomousGameplayReady: false,
      liveWalkVerified: false, terrainVerified: !!data.blocksDecoded && false,
      actionsVerified: false, blockers,
      observed
    };
  }
  allowPreview(data: RuntimeEvidence): { allowed: boolean; reason: string } {
    const snapshot=this.assess(data);
    return { allowed: snapshot.commandEligible,
      reason: snapshot.commandReason };
  }
}
