'use strict';

/**
 * Experimental Bedrock 1.26.60 (protocol 2225) player_auth_input writer.
 *
 * Important: the packet shape has NOT been validated on a real friend-hosted
 * world. It is disabled by default. A requested, confirmed short diagnostic
 * pulse is possible only after a valid StartGame/server-authoritative session.
 * Never use move_player as a client-bound workaround.
 */
const INPUT_TICK_MS = 50;
const PROBE_TICKS = 6;
const PROBE_STEP = 0.065; // Conservative predicted 0.39-block pulse, not a physics engine.
// A stopped client may receive no periodic self-position echoes. The probe is
// still explicitly confirmed and only allowed shortly after a real StartGame.
const MAX_FRESH_MS = 30_000;
const finite3 = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]));
const packetTick = v => v == null ? null : BigInt(v);
const normalYaw = v => ((v % 360) + 360) % 360;

function buildInputPacket(position, yaw, tick, moving) {
  if (!finite3(position) || !Number.isFinite(yaw) || typeof tick !== 'bigint' || tick < 0n)
    throw new TypeError('Invalid player_auth_input state');
  const angle = yaw * Math.PI / 180;
  const shift = moving ? { x: -Math.sin(angle) * PROBE_STEP, y: 0, z: Math.cos(angle) * PROBE_STEP }
    : { x: 0, y: 0, z: 0 };
  const predicted = { x: position.x + shift.x, y: position.y, z: position.z + shift.z };
  const forward = moving ? 1 : 0;
  return {
    pitch: 0,
    yaw: normalYaw(yaw),
    head_yaw: normalYaw(yaw),
    position: predicted,
    move_vector: { x: 0, z: forward },
    // Protocol 2225 represents InputData as a list of enum ordinals, not a bitfield.
    input_data: moving ? [10] : [],
    input_mode: 'touch',
    play_mode: 'normal',
    interaction_model: 1,
    interact_rotation: { x: 0, z: normalYaw(yaw) },
    tick,
    delta: shift,
    analogue_move_vector: { x: 0, z: forward },
    camera_orientation: { x: 0, y: 0, z: 0 },
    raw_move_vector: { x: 0, z: forward }
  };
}

class ExperimentalPlayerInput {
  constructor(client, enabled = false, options = {}) {
    this.client = client;
    this.enabled = enabled === true;
    this.interval = options.interval ?? INPUT_TICK_MS;
    this.setInterval = options.setInterval ?? setInterval;
    this.clearInterval = options.clearInterval ?? clearInterval;
    this.clock = options.clock ?? Date.now;
    this.timer = null;
    this.lastTick = null;
    this.predicted = null;
    this.remaining = 0;
    this.errors = 0;
    this.world = null;
    this.lastYaw = 0;
    this.mode = null;
    this.framesSent = 0;
    this.serverUpdates = 0;
    this.corrections = 0;
    this.stops = 0;
    this.lastEndReason = 'idle';
    this.startedAt = null;
    this.lastServerPosition = null;
    this.lastServerPositionAt = null;
    this.initialPosition = null;
    this.maxDrift = 0;
    this.recentCorrectionCount = 0;
  }
  capability(world) {
    if (!this.enabled || typeof this.client.queue !== 'function') return 'unavailable';
    if (!world || !world.spawned || !finite3(world.position) || !world.self ||
      ![1, 2].includes(world.movementAuthority) || typeof world.serverTick !== 'bigint' ||
      world.receivedChunks.size === 0 || world.lastServerPositionAt == null ||
      this.clock() - world.lastServerPositionAt > MAX_FRESH_MS ||
      this.clock() - world.lastServerPositionAt < 0) return 'unavailable';
    return 'experimental';
  }
  /**
   * Bounded diagnostic input, never a navigation skill. 20Hz writer,
   * at most 20 input frames. Turn tests do not claim successful movement.
   * No automatic repetition, walking to goals, sprint/jump or collision guesses.
   */
  runDiagnostic(world, options = {}) {
    const mode = options.mode ?? 'forward';
    const ticks = options.ticks ?? PROBE_TICKS;
    if (!['forward', 'turn_left', 'turn_right'].includes(mode) ||
        !Number.isInteger(ticks) || ticks < 1 || ticks > 20)
      return { status: 'rejected', reason: 'unsupported_diagnostic' };
    if (this.capability(world) !== 'experimental')
      return { status: 'rejected', reason: 'movement_unavailable' };
    if (this.timer) return { status: 'rejected', reason: 'movement_busy' };
    this.remaining = ticks;
    this.predicted = { ...world.position };
    this.initialPosition = { ...world.position };
    this.lastServerPosition = { ...world.position };
    this.lastServerPositionAt = world.lastServerPositionAt;
    this.lastTick = this.lastTick != null && this.lastTick > world.serverTick
      ? this.lastTick : world.serverTick;
    this.world = world;
    this.lastYaw = Number.isFinite(world.yaw) ? world.yaw : 0;
    this.mode = mode;
    this.framesSent = 0;
    this.serverUpdates = 0;
    this.corrections = 0;
    this.recentCorrectionCount = 0;
    this.maxDrift = 0;
    this.startedAt = this.clock();
    this.lastEndReason = 'in_progress';
    const send = () => {
      if (!this.timer) return;
      if (this.remaining <= 0) { this.stop('bounded_sequence_complete'); return; }
      if (this.capability(world) !== 'experimental') {
        this.stop('authority_or_session_lost');
        return;
      }
      if (world.closed || !world.spawned || world.dimension == null) {
        this.stop('session_changed', { silent: true });
        return;
      }
      // A stop must not depend on a future user request. The session can
      // be paused or killed by the OS, so guard wall time as well as ticks.
      if (this.clock() - this.startedAt > Math.max(2500, ticks * this.interval + 500)) {
        this.stop('deadline_exceeded');
        return;
      }
      try {
        const nextTick = this.lastTick + 1n;
        const isMoving = this.mode === 'forward';
        const yaw = this.mode === 'turn_left' ? this.lastYaw - 5
          : this.mode === 'turn_right' ? this.lastYaw + 5 : this.lastYaw;
        const packet = buildInputPacket(this.predicted, yaw, nextTick, isMoving);
        // The packet builder does not predict jumping/falling or voxel collisions.
        this.client.queue('player_auth_input', packet);
        this.lastTick = nextTick;
        this.lastYaw = yaw;
        this.predicted = packet.position;
        this.remaining--;
        this.framesSent++;
      } catch {
        this.errors++;
        this.stop('packet_write_failed', { silent: true });
      }
    };
    this.timer = this.setInterval(send, this.interval);
    return { status: 'accepted', reason: 'diagnostic_scheduled_not_verified' };
  }
  probeStep(world) {
    const result = this.runDiagnostic(world, { mode: 'forward', ticks: PROBE_TICKS });
    return result.status === 'accepted'
      ? { status: 'accepted', reason: 'experimental_input_queued_not_verified' } : result;
  }
  /** Only the server's report is an observation, not bot-action confirmation. */
  observeServerPosition(position, observedAt) {
    if (!this.timer || !finite3(position)) return;
    this.lastServerPosition = { ...position };
    this.lastServerPositionAt = observedAt;
    this.serverUpdates++;
    if (finite3(this.predicted)) {
      const drift = Math.hypot(position.x - this.predicted.x, position.y - this.predicted.y,
        position.z - this.predicted.z);
      this.maxDrift = Math.max(this.maxDrift, drift);
      // Two consecutive large corrections indicate invalid prediction/physics.
      if (drift >= 1.5) {
        this.recentCorrectionCount++;
        if (this.recentCorrectionCount >= 2) this.stop('prediction_diverged');
      } else this.recentCorrectionCount = 0;
    }
  }
  correct(position, tick) {
    if (!this.timer) return;
    this.corrections++;
    if (finite3(position)) {
      // Correction is a stronger input to the next predicted frame.
      this.observeServerPosition(position, this.clock());
      if (this.timer) this.predicted = { ...position };
    }
    if (typeof tick === 'bigint' && tick > (this.lastTick ?? -1n)) this.lastTick = tick;
  }
  /** Explicit stop emits one neutral frame, unless connection/world ended. */
  stop(reason = 'user_stopped', opts = {}) {
    const active = this.timer != null;
    if (this.timer) this.clearInterval(this.timer);
    this.timer = null;
    this.remaining = 0;
    if (active) this.stops++;
    this.lastEndReason = reason;
    const world = this.world;
    if (active && opts.silent !== true && world && !world.closed && world.spawned &&
        finite3(world.position) && this.predicted && this.lastTick != null) {
      try {
        const neutralTick = this.lastTick + 1n;
        this.client.queue('player_auth_input',
          buildInputPacket(this.predicted, this.lastYaw, neutralTick, false));
        this.lastTick = neutralTick;
      } catch { this.errors++; }
    }
    this.predicted = null;
    this.world = null;
    this.mode = null;
  }
  /** New Xbox world session may restart the authoritative tick counter. */
  resetSession() {
    this.stop('session_reset', { silent: true });
    this.lastTick = null;
    this.predicted = null;
    this.initialPosition = null;
    this.lastServerPosition = null;
    this.lastServerPositionAt = null;
    this.framesSent = 0;
    this.serverUpdates = 0;
    this.corrections = 0;
    this.maxDrift = 0;
  }
  snapshot() {
    const displacement = this.initialPosition && this.lastServerPosition
      ? Math.hypot(
        this.lastServerPosition.x - this.initialPosition.x,
        this.lastServerPosition.y - this.initialPosition.y,
        this.lastServerPosition.z - this.initialPosition.z) : null;
    return {
      mode: this.mode ?? 'idle',
      active: this.timer != null,
      framesSent: this.framesSent,
      serverUpdates: this.serverUpdates,
      corrections: this.corrections,
      maxDrift: Math.round(this.maxDrift * 1000) / 1000,
      observedDisplacement: displacement === null ? null : Math.round(displacement * 1000) / 1000,
      stoppedReason: this.lastEndReason,
      packetErrors: this.errors,
      movementVerified: false,
      gameplayAutonomyReady: false
    };
  }
}

module.exports = { ExperimentalPlayerInput, buildInputPacket };
