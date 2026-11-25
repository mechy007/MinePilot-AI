'use strict';

/**
 * Experimental Bedrock 1.26.60 (protocol 2225) player_auth_input writer.
 *
 * Important: the packet shape has NOT been validated on a real friend-hosted
 * world. It is disabled by default. A requested, confirmed short diagnostic
 * pulse is possible only after a valid StartGame/server-authoritative session.
 * Never use move_player as a client-bound workaround.
 */
const { AuthInputTickClock, TICK_MS: INPUT_TICK_MS } = require('./bedrock-auth-input-clock.cjs');
const PROBE_TICKS = 6;
const PROBE_STEP = 0.065; // User-confirmed diagnostic only.
const VERIFIED_STEP = 0.11; // Conservative flat-ground target, not full Bedrock physics.
const MANUAL_INPUTS = Object.freeze({
  forward: { vector: { x: 0, z: 1 }, flag: 10 },
  backward: { vector: { x: 0, z: -1 }, flag: 11 },
  strafe_left: { vector: { x: -1, z: 0 }, flag: 12 },
  strafe_right: { vector: { x: 1, z: 0 }, flag: 13 }
});
// A stopped client may receive no periodic self-position echoes. The probe is
// still explicitly confirmed and only allowed shortly after a real StartGame.
const MAX_FRESH_MS = 30_000;
const finite3 = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]));
const normalYaw = v => ((v % 360) + 360) % 360;

function buildInputPacket(position, yaw, tick, moving, options = {}) {
  if (!finite3(position) || !Number.isFinite(yaw) || typeof tick !== 'bigint' || tick < 0n)
    throw new TypeError('Invalid player_auth_input state');
  const step=Number.isFinite(options.step) &&
    options.step>=0.02 && options.step<=0.13?options.step:PROBE_STEP;
  const angle = yaw * Math.PI / 180;
  const pitch = Number.isFinite(options.pitch) && Math.abs(options.pitch)<=90
    ? options.pitch : 0;
  const vertical = pitch * Math.PI / 180;
  const vector = options.moveVector ?? (moving ? { x: 0, z: 1 } : { x: 0, z: 0 });
  if (!Number.isFinite(vector.x) || !Number.isFinite(vector.z) ||
      Math.abs(vector.x) > 1 || Math.abs(vector.z) > 1)
    throw new TypeError('Invalid local movement vector');
  // Bedrock move_vector is camera-relative: +Z forward, +X right.
  const shift = moving ? {
    x: (vector.x * Math.cos(angle) - vector.z * Math.sin(angle)) * step,
    y: 0,
    z: (vector.x * Math.sin(angle) + vector.z * Math.cos(angle)) * step
  } : { x: 0, y: 0, z: 0 };
  const predicted = { x: position.x + shift.x, y: position.y, z: position.z + shift.z };
  const inputFlag = Number.isInteger(options.inputFlag) ? options.inputFlag : moving ? 10 : null;
  return {
    pitch,
    yaw: normalYaw(yaw),
    head_yaw: normalYaw(yaw),
    position: predicted,
    move_vector: { x: vector.x, z: vector.z },
    // Protocol 2225 represents InputData as a list of enum ordinals, not a bitfield.
    input_data: inputFlag == null ? [] : [inputFlag],
    input_mode: 'touch',
    play_mode: 'normal',
    interaction_model: 1,
    interact_rotation: { x: pitch, z: normalYaw(yaw) },
    tick,
    delta: shift,
    analogue_move_vector: { x: vector.x, z: vector.z },
    // Protocol 2225 requires a world-space unit forward vector, not an
    // all-zero placeholder that cannot represent any look direction.
    camera_orientation: { x: Math.sin(angle)===0?0:
      -Math.sin(angle)*Math.cos(vertical),
      y: Math.sin(vertical)===0?0:-Math.sin(vertical),
      z: Math.cos(angle)*Math.cos(vertical) },
    raw_move_vector: { x: vector.x, z: vector.z }
  };
}

class ExperimentalPlayerInput {
  constructor(client, enabled = false, options = {}) {
    this.client = client;
    this.enabled = enabled === true;
    // Neutral standing-still input is separate from opt-in physical movement.
    // Enabled only for the real authenticated Android session, never fixtures.
    this.presenceEnabled = options.presenceEnabled === true;
    this.blockExecutor = options.blockExecutor ?? null;
    this.presenceTimer = null;
    this.presenceWorld = null;
    this.presenceFrames = 0;
    this.presenceError = null;
    this.interval = options.interval ?? INPUT_TICK_MS;
    this.setInterval = options.setInterval ?? setInterval;
    this.clearInterval = options.clearInterval ?? clearInterval;
    this.clock = options.clock ?? Date.now;
    this.tickClock = new AuthInputTickClock({clock:this.clock});
    this.timer = null;
    this.lastTick = null;
    this.predicted = null;
    this.remaining = 0;
    this.errors = 0;
    this.world = null;
    this.lastYaw = 0;
    this.mode = null;
    this.requireVerifiedTerrain = false;
    this.predictionStep = PROBE_STEP;
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
    this.manualHoldActive = false;
    this.manualHoldDeadline = 0;
    this.unconfirmedMovement = false;
    this.unconfirmedMovement = false;
    this.manualAnchor = null;
    this.manualAnchorWorld = null;
    this.manualAnchorDimension = null;
  }
  /** Update or start one continuous user-held control stream. */
  runManualHold(world, options = {}) {
    const mode = options.mode ?? '';
    const ticks = options.ticks ?? 8;
    if (!['forward','backward','strafe_left','strafe_right','turn_left','turn_right'].includes(mode) ||
        !Number.isInteger(ticks) || ticks < 1 || ticks > 8)
      return {status:'rejected',reason:'unsupported_manual_input'};

    const now = this.clock();
    if (this.timer && this.manualHoldActive) {
      if (this.world !== world || now > this.manualHoldDeadline) {
        this.stop('manual_input_timeout');
        return {status:'rejected',reason:'manual_hold_expired'};
      }
      if (this.capability(world) !== 'experimental')
        return {status:'rejected',reason:'movement_unavailable'};
      // Keep the same prediction origin and tick writer while changing
      // direction. Re-starting every half-second would rewind to an old
      // server position on worlds that do not echo every accepted input.
      this.mode = mode;
      this.remaining = Math.max(this.remaining, 10);
      this.manualHoldDeadline = now + 1100;
      return {status:'accepted',reason:'manual_hold_updated'};
    }
    if (this.timer) return {status:'rejected',reason:'movement_busy'};

    const initialPosition = this.manualAnchorWorld === world &&
      this.manualAnchorDimension === world.dimension && finite3(this.manualAnchor)
        ? { ...this.manualAnchor } : { ...world.position };
    const started = this.runDiagnostic(world, {
      mode,ticks:20,manualHold:true,initialPosition
    });
    if (started.status === 'accepted') {
      this.manualHoldActive = true;
      this.manualHoldDeadline = now + 1100;
      this.remaining = 20;
    }
    return started;
  }
  /** Continuous *neutral* PlayerAuthInput; no client-predicted locomotion. */
  startPresence(world) {
    if (!this.presenceEnabled || this.presenceTimer ||
        typeof this.client.queue !== 'function') return false;
    // Spawn alone is not a valid tick source; wait for StartGame and the
    // explicit server-authoritative movement setting if supplied.
    if (!world || !world.spawned || !finite3(world.position) || !world.self ||
        typeof world.serverTick !== 'bigint' || world.serverTick < 0n ||
        ![1, 2].includes(world.movementAuthority) ||
        world.closed || world.dimension == null) return false;
    this.presenceWorld = world;
    if(!this.tickClock.seed(world.serverTick,world.serverTickObservedAt??this.clock()))
      return false;
    this.lastTick=this.tickClock.lastTick??world.serverTick;
    const pulse = () => {
      const current = this.presenceWorld;
      if (!current || current.closed || !current.spawned ||
          ![1, 2].includes(current.movementAuthority) ||
          !finite3(current.position) || current.self == null ||
          current.dimension == null) {
        this.stopPresence('session_or_authority_lost');
        return;
      }
      // The bounded movement diagnostic takes full ownership of the same tick
      // stream. Presence never emits an overlapping or out-of-order frame.
      if (this.timer) return;
      try {
        const tick = this.tickClock.next();
        const yaw = Number.isFinite(current.yaw) ? current.yaw : this.lastYaw;
        const packet = buildInputPacket(current.position,yaw,tick,false,
          {pitch:current.pitch});
        // Bedrock's server-authoritative block break action is an optional
        // field on the SAME movement tick. Never create a competing tick writer.
        const blockAction = this.blockExecutor?.next?.(current);
        if(blockAction) {
          packet.input_data=[35];
          packet.block_action=[blockAction];
        }
        this.client.queue('player_auth_input', packet);
        this.blockExecutor?.pulseTimeout?.();
        this.lastTick = tick;
        this.lastYaw = yaw;
        this.presenceFrames++;
      } catch {
        this.errors++;
        this.presenceError = 'presence_input_failed';
        this.blockExecutor?.abort?.('packet_write_failed');
        this.stopPresence('packet_write_failed');
      }
    };
    this.presenceTimer = this.setInterval(pulse, this.interval);
    return true;
  }
  stopPresence(reason = 'stopped') {
    if (this.presenceTimer) this.clearInterval(this.presenceTimer);
    this.presenceTimer = null;
    this.presenceWorld = null;
    this.blockExecutor?.abort?.('presence_stopped');
    if (reason === 'packet_write_failed') this.presenceError = reason;
  }
  capability(world) {
    if (!this.enabled || typeof this.client.queue !== 'function') return 'unavailable';
    if (!world || !world.spawned || !finite3(world.position) || !world.self ||
      ![1, 2].includes(world.movementAuthority) || typeof world.serverTick !== 'bigint' ||
      world.receivedChunks.size === 0 || world.lastServerPositionAt == null ||
      this.clock() - world.lastServerPositionAt < 0 ||
      (this.clock() - world.lastServerPositionAt > MAX_FRESH_MS &&
        !(this.presenceTimer && this.presenceFrames > 0))) return 'unavailable';
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
    const manualHold = options.manualHold === true;
    if (!['forward', 'backward', 'strafe_left', 'strafe_right',
        'turn_left', 'turn_right'].includes(mode) ||
        !Number.isInteger(ticks) || ticks < 1 || ticks > 20 ||
        (manualHold && ticks !== 20))
      return { status: 'rejected', reason: 'unsupported_diagnostic' };
    if (this.capability(world) !== 'experimental')
      return { status: 'rejected', reason: 'movement_unavailable' };
    if (this.timer) return { status: 'rejected', reason: 'movement_busy' };
    this.remaining = ticks;
    const origin = finite3(options.initialPosition) ? options.initialPosition : world.position;
    this.predicted = { ...origin };
    this.initialPosition = { ...origin };
    this.lastServerPosition = { ...world.position };
    this.lastServerPositionAt = world.lastServerPositionAt;
    if(!this.tickClock.seed(world.serverTick,world.serverTickObservedAt??this.clock()))
      return {status:'rejected',reason:'invalid_server_tick'};
    this.lastTick=this.tickClock.lastTick??world.serverTick;
    this.world = world;
    this.lastYaw = Number.isFinite(options.initialYaw)
      ? normalYaw(options.initialYaw) : Number.isFinite(world.yaw) ? world.yaw : 0;
    this.mode = mode;
    this.requireVerifiedTerrain=options.verifiedTerrain===true;
    this.predictionStep=this.requireVerifiedTerrain?VERIFIED_STEP:PROBE_STEP;
    this.framesSent = 0;
    this.serverUpdates = 0;
    this.corrections = 0;
    this.recentCorrectionCount = 0;
    this.maxDrift = 0;
    this.startedAt = this.clock();
    this.lastEndReason = 'in_progress';
    const send = () => {
      if (!this.timer) return;
      if (this.manualHoldActive) {
        if (this.clock() > this.manualHoldDeadline) {
          this.stop('manual_input_timeout');
          return;
        }
        if (this.remaining <= 0) this.remaining = 20;
      } else if (this.remaining <= 0) {
        this.stop('bounded_sequence_complete');
        return;
      }
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
      if (!this.manualHoldActive &&
          this.clock() - this.startedAt > Math.max(2500, ticks * this.interval + 500)) {
        this.stop('deadline_exceeded');
        return;
      }
      try {
        const nextTick = this.tickClock.next();
        const movementInput = MANUAL_INPUTS[this.mode];
        const isMoving = movementInput != null;
        const yaw = this.mode === 'turn_left' ? this.lastYaw - 5
          : this.mode === 'turn_right' ? this.lastYaw + 5 : this.lastYaw;
        const packet = buildInputPacket(this.predicted, yaw, nextTick, isMoving, {
          pitch:world.pitch, step:this.predictionStep,
          moveVector:movementInput?.vector ?? {x:0,z:0},
          inputFlag:movementInput?.flag
        });
        if(isMoving&&this.requireVerifiedTerrain &&
          !this.verifiedFlatFootprint(world,this.predicted,packet.position)){
          this.stop('unverified_or_blocked_next_step');
          return;
        }
        // No jump, flight or speculative vertical physics. Use decoded
        // walkable AABB footprint for this bounded flat movement segment.
        this.client.queue('player_auth_input', packet);
        if (isMoving) this.unconfirmedMovement = true;
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
  /**
   * Real (not just planned) bounded movement along one verified local waypoint.
   * The caller must validate terrain and obtain user approval before invocation.
   * This does not assert server acceptance or actual locomotion.
   */
  verifiedFlatFootprint(world,from,to) {
    if(!finite3(from)||!finite3(to)||!world?.terrain ||
      !Number.isInteger(world.dimension))return false;
    if(Math.abs(to.y-from.y)>0.01)return false;
    const y=Math.floor(to.y-1.62+0.01);
    if(!Number.isInteger(y))return false;
    // Check path and body corners: moving diagonally near a wall must not
    // consider only the center cell and walk through its solid neighbor.
    for(const factor of [0.5,1]){
      const x=from.x+(to.x-from.x)*factor;
      const z=from.z+(to.z-from.z)*factor;
      for(const dx of [-0.29,0,0.29])for(const dz of [-0.29,0,0.29]){
        if(world.terrain.tile(world.dimension,Math.floor(x+dx),y,
          Math.floor(z+dz))!=='walkable')return false;
      }
    }
    return true;
  }
  runVerifiedStep(world, target, ticks = 8) {
    if (!finite3(world?.position) || !finite3(target) ||
        !Number.isInteger(ticks) || ticks < 1 || ticks > 12)
      return {status:'rejected', reason:'invalid_waypoint'};
    const dx=target.x-world.position.x, dz=target.z-world.position.z;
    const distance=Math.hypot(dx,dz);
    if (distance<0.08 || distance>2.1 || Math.abs(target.y-world.position.y)>0.85)
      return {status:'rejected', reason:'waypoint_outside_verified_step'};
    const yaw=normalYaw(Math.atan2(-dx,dz)*180/Math.PI);
    if(!this.verifiedFlatFootprint(world,world.position,target))
      return {status:'rejected',reason:'unverified_waypoint_footprint'};
    const result=this.runDiagnostic(world,{
      mode:'forward',ticks,initialYaw:yaw,verifiedTerrain:true
    });
    return result.status==='accepted'
      ? {status:'accepted',reason:'verified_waypoint_queued_not_host_confirmed'}
      : result;
  }
  probeStep(world) {
    const result = this.runDiagnostic(world, { mode: 'forward', ticks: PROBE_TICKS });
    return result.status === 'accepted'
      ? { status: 'accepted', reason: 'experimental_input_queued_not_verified' } : result;
  }
  /** Only the server's report is an observation, not bot-action confirmation. */
  observeServerPosition(position, observedAt) {
    if (!finite3(position)) return;
    this.lastServerPosition = { ...position };
    this.lastServerPositionAt = observedAt;
    this.unconfirmedMovement = false;
    if (this.manualAnchorWorld &&
        this.manualAnchorDimension === this.manualAnchorWorld.dimension) {
      this.manualAnchor = { ...position };
    }
    if (!this.timer) return;
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
    // Reconcile the shared input clock even during neutral presence; previous
    // implementation ignored every correction unless movement was running.
    if(typeof tick==='bigint')this.tickClock.correction(tick);
    if (!this.timer) {
      if (finite3(position)) this.observeServerPosition(position, this.clock());
      return;
    }
    this.corrections++;
    if (finite3(position)) {
      // Correction is a stronger input to the next predicted frame.
      this.observeServerPosition(position, this.clock());
      if (this.timer) this.predicted = { ...position };
    }
    if(this.tickClock.lastTick!=null)this.lastTick=this.tickClock.lastTick;
  }
  /** Explicit stop emits one neutral frame, unless connection/world ended. */
  stop(reason = 'user_stopped', opts = {}) {
    this.blockExecutor?.abort?.('movement_stopped');
    const active = this.timer != null;
    const wasManualHold = this.manualHoldActive;
    if (this.timer) this.clearInterval(this.timer);
    this.timer = null;
    this.remaining = 0;
    if (active) this.stops++;
    this.lastEndReason = reason;
    const world = this.world;
    if (active && opts.silent !== true && world && !world.closed && world.spawned &&
        finite3(world.position) && this.predicted && this.lastTick != null) {
      try {
        const neutralTick = this.tickClock.next();
        // For a user-held manual stream, keep the last predicted input
        // position when neutralizing. Rewinding to an older server anchor
        // after a quiet (no-correction) movement session would undo the
        // position carried by the preceding PlayerAuthInput frames. A server
        // correction observed during the hold already overwrites predicted.
        const neutralPosition = wasManualHold && finite3(this.predicted)
          ? this.predicted : finite3(world.position)
            ? world.position : finite3(this.lastServerPosition)
              ? this.lastServerPosition : null;
        if (neutralPosition) this.client.queue('player_auth_input',
          buildInputPacket(neutralPosition, this.lastYaw, neutralTick, false,
            {pitch:world.pitch}));
        this.lastTick = neutralTick;
      } catch { this.errors++; }
    }
    if (wasManualHold &&
        ['manual_control_released','manual_input_timeout'].includes(reason) &&
        world && !world.closed && finite3(this.predicted)) {
      this.manualAnchor = { ...this.predicted };
      this.manualAnchorWorld = world;
      this.manualAnchorDimension = world.dimension;
    }
    this.predicted = null;
    this.world = null;
    this.mode = null;
    this.manualHoldActive = false;
    this.manualHoldDeadline = 0;
    this.requireVerifiedTerrain=false;
    this.predictionStep=PROBE_STEP;
  }
  /** New Xbox world session may restart the authoritative tick counter. */
  resetSession() {
    this.stopPresence('world_reset');
    this.stop('session_reset', { silent: true });
    this.tickClock.reset();
    this.lastTick = null;
    this.predicted = null;
    this.initialPosition = null;
    this.lastServerPosition = null;
    this.lastServerPositionAt = null;
    this.manualAnchor = null;
    this.manualAnchorWorld = null;
    this.manualAnchorDimension = null;
    this.framesSent = 0;
    this.serverUpdates = 0;
    this.corrections = 0;
    this.maxDrift = 0;
    this.presenceFrames = 0;
    this.presenceError = null;
  }
  snapshot() {
    const displacement = this.initialPosition && this.lastServerPosition
      ? Math.hypot(
        this.lastServerPosition.x - this.initialPosition.x,
        this.lastServerPosition.y - this.initialPosition.y,
        this.lastServerPosition.z - this.initialPosition.z) : null;
    return {
      mode: this.mode ?? 'idle',
      presenceActive: this.presenceTimer != null,
      presenceFrames: this.presenceFrames,
      presenceError: this.presenceError,
      active: this.timer != null,
      framesSent: this.framesSent,
      unconfirmedMovement: this.unconfirmedMovement,
      serverUpdates: this.serverUpdates,
      corrections: this.corrections,
      maxDrift: Math.round(this.maxDrift * 1000) / 1000,
      motionModel: this.requireVerifiedTerrain?'verified_flat_footprint':'bounded_diagnostic',
      predictedStepSize: this.predictionStep,
      observedDisplacement: displacement === null ? null : Math.round(displacement * 1000) / 1000,
      stoppedReason: this.lastEndReason,
      inputClock: this.tickClock.snapshot(),
      packetErrors: this.errors,
      movementVerified: false,
      gameplayAutonomyReady: false
    };
  }
}

module.exports = { ExperimentalPlayerInput, buildInputPacket };
