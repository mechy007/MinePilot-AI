'use strict';

const path = require('node:path');
const vendorRoot = path.basename(__dirname) === 'scripts'
  ? path.resolve(__dirname, '..', 'vendor')
  : path.join(__dirname, 'vendor');
const { Vec3 } = require(path.join(vendorRoot, 'bedboo-physics/lib/vec3'));
const { Physics, PlayerState } = require(path.join(vendorRoot, 'bedboo-physics/lib/physics'));
const { buildFlags } = require(path.join(vendorRoot, 'bedboo-physics/lib/physics/input'));
const { createInputQueue } = require(path.join(vendorRoot, 'bedboo-physics/lib/bedrock/input_queue'));
const { EYE_HEIGHT } = require(path.join(vendorRoot, 'bedboo-physics/lib/bedrock/constants'));
const { loadBedrockCollisionData } = require('./bedrock-collision-data.cjs');

const TICK_MS = 50;
const HISTORY_LIMIT = 60;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const finite3 = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]));
const validTick = value => typeof value === 'bigint' && value >= 0n;
const wireYaw = yaw => ((180 - yaw * 180 / Math.PI) % 360 + 360) % 360;
const wirePitch = pitch => clamp(-pitch * 180 / Math.PI, -90, 90);
const fromWireYaw = yaw => Math.PI - Number(yaw) * Math.PI / 180;
const fromWirePitch = pitch => -Number(pitch) * Math.PI / 180;
const viewDirection = (yaw, pitch) => {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
};
const feetFromWire = p => new Vec3(p.x, p.y - EYE_HEIGHT, p.z);
const feetToWire = p => ({ x: p.x, y: p.y + EYE_HEIGHT, z: p.z });

function cloneState(state) {
  const out = { ...state };
  out.pos = state.pos.clone();
  out.vel = state.vel.clone();
  out.control = { ...(state.control ?? {}) };
  out.moveVector = state.moveVector ? { ...state.moveVector } : undefined;
  out.attributes = state.attributes ? { ...state.attributes } : {};
  return out;
}

function restoreState(target, snapshot) {
  const copy = cloneState(snapshot);
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, copy);
  return target;
}

class BedrockPhysicsWorld {
  constructor(terrain, collisionData, dimension) {
    this.terrain = terrain;
    this.collisionData = collisionData;
    this.dimension = dimension;
    this.unknown = false;
    this.queries = 0;
    this.hashedIds = false;
  }
  beginTick() {
    this.unknown = false;
    this.queries = 0;
  }
  getBlock(pos) {
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    const runtimeId = this.terrain?.blockId(this.dimension, x, y, z);
    this.queries++;
    if (runtimeId === null || runtimeId === undefined) {
      this.unknown = true;
      return null;
    }
    const key = this.hashedIds ? (Number(runtimeId) >>> 0) : Number(runtimeId);
    const profile = this.hashedIds
      ? this.collisionData.profilesByHash.get(key)
      : this.collisionData.profilesByStateId.get(key);
    const registered = this.terrain?.registry?.get(key);
    const expectedName = profile?.name?.startsWith('minecraft:')
      ? profile.name : 'minecraft:' + (profile?.name ?? '');
    if (!profile || !registered || registered.name !== expectedName) {
      this.unknown = true;
      return null;
    }
    const block = {
      name: profile.name.replace(/^minecraft:/, ''),
      type: profile.id,
      boundingBox: profile.boundingBox,
      friction: profile.friction,
      metadata: profile.metadata,
      isWaterlogged: profile.isWaterlogged,
      _properties: profile.properties,
      position: new Vec3(x, y, z),
      shapes: profile.shapes,
      getProperties: () => profile.properties
    };
    return block;
  }
}

class BedrockMovementController {
  constructor(client, options = {}) {
    if (!client || typeof client.queue !== 'function') throw new TypeError('Bedrock client is required');
    this.client = client;
    this.terrain = options.terrain ?? null;
    this.collisionData = options.collisionData ?? null;
    this.physics = null;
    this.physicsWorld = null;
    this.queueBot = { _client: client, emit: () => {} };
    this.inputQueue = createInputQueue(this.queueBot, {
      now: options.clock ?? Date.now,
      maxCatchupTicks: 4,
      timers: options.timers
    });
    this.world = null;
    this.state = null;
    this.previousInput = null;
    this.history = [];
    this.controls = { x: 0, z: 0, jump: false, sprint: false, sneak: false };
    this.manualHoldDeadline = 0;
    this.manualHoldActive = false;
    this.lastServerPosition = null;
    this.lastServerPositionAt = null;
    this.lastServerTick = null;
    this.started = false;
    this.framesSent = 0;
    this.corrections = 0;
    this.lastCorrection = null;
    this.lastError = null;
    this.lastMovementResult = { status: 'idle', reason: 'not_started' };
    this.lastInput = null;
    this.inputQueue.setProvider((tick) => this.tick(tick));
    this.inputQueue.onSent((packet, tick) => {
      this.framesSent++;
      this.lastInput = { tick: String(tick), position: packet.position, delta: packet.delta,
        input: packet.input_data ?? [] };
    });
  }

  loadPhysics() {
    if (this.physics) return true;
    try {
      this.collisionData ??= loadBedrockCollisionData();
      this.physicsWorld = new BedrockPhysicsWorld(this.terrain, this.collisionData, this.world?.dimension);
      this.physics = Physics(this.collisionData.registry, this.physicsWorld);
      return true;
    } catch (error) {
      this.lastError = error?.message ?? 'physics_data_unavailable';
      this.lastMovementResult = { status: 'unavailable', reason: 'physics_data_unavailable' };
      return false;
    }
  }

  capability(world = this.world) {
    if (!this.started || !this.inputQueue.isRunning()) return 'unavailable';
    if (!world || world.closed || !world.spawned || !finite3(world.position) ||
        !world.self || ![1, 2].includes(world.movementAuthority) ||
        !validTick(world.serverTick) || !world.terrain ||
        world.terrain.dimension !== world.dimension || world.receivedChunks?.size === 0) return 'unavailable';
    if (!this.collisionData || !this.physics || !this.physicsWorld) return 'unavailable';
    return this.physicsWorld.unknown ? 'unavailable' : 'ready';
  }

  startPresence(world) {
    if (!world || !world.spawned || !finite3(world.position) || !world.self ||
        ![1, 2].includes(world.movementAuthority) || !validTick(world.serverTick) ||
        world.closed || world.dimension == null || !world.terrain) return false;
    this.world = world;
    this.terrain = world.terrain;
    if (!this.loadPhysics()) return false;
    this.physicsWorld.dimension = world.dimension;
    const hashedAirId = (-604749536) >>> 0;
    this.physicsWorld.hashedIds = world.blockNetworkIdsAreHashes === true ||
      (world.blockNetworkIdsAreHashes !== false && this.terrain.registry?.has(hashedAirId) === true);
    this.lastServerPosition = { ...world.position };
    this.lastServerPositionAt = world.lastServerPositionAt ?? Date.now();
    this.lastServerTick = world.serverTick;
    if (!this.started || !this.state) this.resetFromServer(world.position, world.yaw, world.pitch, false);
    this.preflightTerrain(world);
    this.inputQueue.anchor(world.serverTick, world.serverTickObservedAt ?? Date.now());
    this.inputQueue.start();
    this.started = true;
    this.lastMovementResult = { status: 'ready', reason: 'server_tick_stream_started' };
    return true;
  }

  resetFromServer(position, yaw, pitch, onGround = false, delta = { x: 0, y: 0, z: 0 }) {
    if (!finite3(position)) return false;
    const entity = {
      position: feetFromWire(position),
      velocity: new Vec3(Number(delta.x) || 0, Number(delta.y) || 0, Number(delta.z) || 0),
      onGround: !!onGround,
      isInWater: false,
      isInLava: false,
      isInWeb: false,
      isCollidedHorizontally: false,
      isCollidedVertically: !!onGround,
      elytraFlying: false,
      attributes: {},
      effects: {},
      yaw: Number.isFinite(yaw) ? fromWireYaw(yaw) : 0,
      pitch: Number.isFinite(pitch) ? fromWirePitch(pitch) : 0
    };
    const shim = {
      registry: this.collisionData?.registry ?? { blocksByName: {}, blocksArray: [], effectsByName: {} },
      entity,
      jumpTicks: 0,
      jumpQueued: false,
      fireworkRocketDuration: 0,
      inventory: { slots: [] },
      abilities: {},
      _bedrock: { physics: { isFlying: () => false } }
    };
    this.state = new PlayerState(shim, { forward: false, back: false, left: false, right: false,
      jump: false, sprint: false, sneak: false });
    this.state.moveVector = { x: 0, z: 0 };
    this.previousInput = null;
    this.history = [];
    this.lastServerPosition = { ...position };
    this.lastServerPositionAt = Date.now();
    return true;
  }

  setControls(vector = {}, options = {}) {
    const x = clamp(Number(vector.x) || 0, -1, 1);
    const z = clamp(Number(vector.z) || 0, -1, 1);
    const length = Math.hypot(x, z);
    const scale = length > 1 ? 1 / length : 1;
    this.controls = {
      x: x * scale,
      z: z * scale,
      jump: options.jump === true,
      sprint: options.sprint === true,
      sneak: options.sneak === true
    };
  }

  preflightTerrain(world = this.world) {
    if (!world || !finite3(world.position) || !this.physicsWorld) return false;
    const feet = feetFromWire(world.position);
    this.physicsWorld.beginTick();
    for (let y = Math.floor(feet.y) - 1; y <= Math.floor(feet.y + 2); y++) {
      for (let z = Math.floor(feet.z) - 1; z <= Math.floor(feet.z + 1); z++) {
        for (let x = Math.floor(feet.x) - 1; x <= Math.floor(feet.x + 1); x++) {
          this.physicsWorld.getBlock(new Vec3(x, y, z));
        }
      }
    }
    return !this.physicsWorld.unknown;
  }

  runManualHold(world, options = {}) {
    if (this.capability(world) !== 'ready' || !this.preflightTerrain(world)) {
      return { status: 'rejected', reason: this.lastError ? 'physics_data_unavailable' : 'terrain_not_fully_observed' };
    }
    const modes = {
      forward: { x: 0, z: 1 }, backward: { x: 0, z: -1 },
      strafe_left: { x: -1, z: 0 }, strafe_right: { x: 1, z: 0 },
      turn_left: { x: 0, z: 0 }, turn_right: { x: 0, z: 0 },
      jump: { x: 0, z: 0 }, sprint: { x: 0, z: 0 }, sneak: { x: 0, z: 0 }
    };
    const vector = options.vector && Number.isFinite(options.vector.x) && Number.isFinite(options.vector.y)
      ? { x: options.vector.x, z: options.vector.y } : modes[options.mode];
    if (!vector) return { status: 'rejected', reason: 'unsupported_manual_input' };
    this.setControls(vector, options);
    if (options.mode === 'turn_left' || options.mode === 'turn_right') {
      const direction = options.mode === 'turn_left' ? -1 : 1;
      if (this.state) this.state.yaw += direction * (5 * Math.PI / 180);
    }
    this.manualHoldActive = Math.hypot(vector.x, vector.z) > 0 || options.jump === true ||
      options.sprint === true || options.sneak === true;
    this.manualHoldDeadline = Date.now() + 1100;
    this.lastMovementResult = { status: 'accepted', reason: 'movement_controls_applied' };
    return this.lastMovementResult;
  }

  runVerifiedStep(world, target, ticks = 8) {
    if (this.capability(world) !== 'ready' || !this.preflightTerrain(world) || !finite3(target) ||
        !Number.isInteger(ticks) || ticks < 1 || ticks > 20) {
      return { status: 'rejected', reason: 'movement_unavailable' };
    }
    const dx = target.x - world.position.x;
    const dz = target.z - world.position.z;
    if (Math.hypot(dx, dz) < 0.15) {
      this.releaseManual();
      return { status: 'ok', reason: 'target_reached' };
    }
    const yawDegrees = Math.atan2(-dx, dz) * 180 / Math.PI;
    if (this.state) this.state.yaw = fromWireYaw(yawDegrees);
    this.setControls({ x: 0, z: 1 });
    this.manualHoldActive = true;
    this.manualHoldDeadline = Date.now() + ticks * TICK_MS;
    this.lastMovementResult = { status: 'accepted', reason: 'verified_navigation_step' };
    return this.lastMovementResult;
  }

  observeRotation(yaw, pitch) {
    if (!this.state) return;
    if (Number.isFinite(yaw)) this.state.yaw = fromWireYaw(yaw);
    if (Number.isFinite(pitch)) this.state.pitch = fromWirePitch(pitch);
  }

  releaseManual() {
    this.setControls();
    this.manualHoldActive = false;
    this.manualHoldDeadline = 0;
    this.lastMovementResult = { status: 'idle', reason: 'manual_control_released' };
  }

  stopPresence(reason = 'stopped') {
    this.releaseManual();
    this.lastMovementResult = { status: 'idle', reason };
  }

  tick(tick) {
    const world = this.world;
    if (!world || world.closed || !world.spawned || !finite3(world.position) ||
        ![1, 2].includes(world.movementAuthority) || !this.state || !this.physicsWorld) {
      return this.idleFrame(world, tick);
    }
    if (this.manualHoldActive && Date.now() > this.manualHoldDeadline) this.releaseManual();
    const control = {
      forward: this.controls.z > 0.08,
      back: this.controls.z < -0.08,
      left: this.controls.x < -0.08,
      right: this.controls.x > 0.08,
      jump: this.controls.jump,
      sprint: this.controls.sprint && this.controls.z > 0.08 && !this.controls.sneak,
      sneak: this.controls.sneak
    };
    const raw = { x: -this.controls.x, z: this.controls.z };
    const magnitude = Math.hypot(raw.x, raw.z);
    const processed = magnitude > 1 ? { x: raw.x / magnitude, z: raw.z / magnitude } : { ...raw };
    const input = {
      control,
      rawMoveVector: raw,
      moveVector: processed,
      yaw: this.state.yaw,
      pitch: this.state.pitch,
      flying: !!this.state.flying,
      gliding: !!this.state.elytraFlying,
      sprinting: control.sprint,
      sneaking: control.sneak && !this.state.flying
    };
    const before = cloneState(this.state);
    this.physicsWorld.beginTick();
    this.applyInput(this.state, input);
    this.physics.simulatePlayer(this.state, this.physicsWorld);
    if (this.physicsWorld.unknown) {
      restoreState(this.state, before);
      this.lastMovementResult = { status: 'unavailable', reason: 'terrain_not_fully_observed' };
      return this.idleFrame(world, tick);
    }
    const current = {
      control,
      sprinting: input.sprinting,
      sneaking: input.sneaking,
      swimming: !!this.state.isInWater,
      gliding: !!this.state.elytraFlying,
      flying: !!this.state.flying,
      jumped: !!this.state.jumped,
      onGround: !!this.state.onGround,
      collidedHorizontally: !!this.state.isCollidedHorizontally,
      collidedVertically: !!this.state.isCollidedVertically
    };
    const flags = buildFlags(this.previousInput, current);
    const yaw = wireYaw(this.state.yaw);
    const pitch = wirePitch(this.state.pitch);
    const velocity = this.state.vel;
    const position = feetToWire(this.state.pos);
    const frame = {
      position,
      yaw,
      pitch,
      head_yaw: yaw,
      delta: { x: velocity.x, y: velocity.y, z: velocity.z },
      move_vector: processed,
      raw_move_vector: raw,
      analogue_move_vector: raw,
      camera_orientation: viewDirection(this.state.yaw, this.state.pitch),
      interact_rotation: { x: pitch, z: yaw },
      input_data: flags,
      input_mode: 'touch',
      play_mode: 'normal',
      interaction_model: 'crosshair'
    };
    this.previousInput = current;
    this.history.push({ tick, input: this.captureInput(input), state: cloneState(this.state) });
    if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT);
    this.lastMovementResult = { status: 'simulating', reason: 'physics_tick' };
    return frame;
  }

  applyInput(state, input) {
    state.control = { ...input.control };
    state.yaw = input.yaw;
    state.pitch = input.pitch;
    state.flying = input.flying;
    state.moveVector = { ...input.moveVector };
    state.jumpQueued = false;
    state.elytraFlying = input.gliding;
  }

  captureInput(input) {
    return {
      control: { ...input.control },
      moveVector: { ...input.moveVector },
      rawMoveVector: { ...input.rawMoveVector },
      yaw: input.yaw,
      pitch: input.pitch,
      flying: input.flying,
      gliding: input.gliding,
      sprinting: input.sprinting,
      sneaking: input.sneaking
    };
  }

  idleFrame(world, tick) {
    const position = finite3(world?.position) ? { ...world.position } :
      this.lastServerPosition ?? { x: 0, y: 0, z: 0 };
    const yaw = Number.isFinite(world?.yaw) ? world.yaw : 0;
    const pitch = Number.isFinite(world?.pitch) ? world.pitch : 0;
    const yawRad = fromWireYaw(yaw);
    const pitchRad = fromWirePitch(pitch);
    return {
      position, yaw, pitch, head_yaw: yaw,
      delta: this.state?.vel ? { x: this.state.vel.x, y: this.state.vel.y, z: this.state.vel.z } : { x: 0, y: 0, z: 0 },
      move_vector: { x: 0, z: 0 }, raw_move_vector: { x: 0, z: 0 },
      analogue_move_vector: { x: 0, z: 0 },
      camera_orientation: viewDirection(yawRad, pitchRad),
      interact_rotation: { x: pitch, z: yaw },
      input_data: [], input_mode: 'touch', play_mode: 'normal', interaction_model: 'crosshair'
    };
  }

  observeServerPosition(position, observedAt = Date.now()) {
    if (!finite3(position)) return;
    this.lastServerPosition = { ...position };
    this.lastServerPositionAt = observedAt;
  }

  teleport(position, packet = {}) {
    if (!finite3(position)) return;
    const delta = { x: 0, y: 0, z: 0 };
    this.resetFromServer(position, Number.isFinite(packet.yaw) ? packet.yaw : this.world?.yaw,
      Number.isFinite(packet.pitch) ? packet.pitch : this.world?.pitch,
      packet.on_ground === true, delta);
    this.inputQueue.markTeleportHandled();
    this.lastMovementResult = { status: 'reconciled', reason: 'server_teleport' };
  }

  correct(position, tick, packet = {}) {
    if (!finite3(position)) return;
    const tickValue = tick == null ? null : (typeof tick === 'bigint' ? tick :
      (Number.isInteger(Number(tick)) ? BigInt(tick) : null));
    const corrected = {
      pos: feetFromWire(position),
      vel: new Vec3(Number(packet.delta?.x) || 0, Number(packet.delta?.y) || 0, Number(packet.delta?.z) || 0),
      onGround: packet.on_ground === true
    };
    if (!this.state) this.resetFromServer(position, this.world?.yaw, this.world?.pitch,
      corrected.onGround, corrected.vel);
    let replayFailed = false;
    const index = tickValue == null ? -1 : this.history.findIndex(entry => entry.tick === tickValue);
    if (index >= 0) {
      Object.assign(this.history[index].state, {
        pos: corrected.pos.clone(), vel: corrected.vel.clone(), onGround: corrected.onGround
      });
      let state = cloneState(this.history[index].state);
      for (let i = index + 1; i < this.history.length; i++) {
        const entry = this.history[i];
        this.applyInput(state, entry.input);
        if (entry.input.knockback) state.vel = entry.input.knockback.clone();
        this.physicsWorld.beginTick();
        this.physics.simulatePlayer(state, this.physicsWorld);
        if (this.physicsWorld.unknown) {
          this.state = cloneState(this.history[index].state);
          this.history.splice(index + 1);
          this.lastMovementResult = { status: 'unavailable', reason: 'terrain_not_fully_observed' };
          replayFailed = true;
          break;
        }
        entry.state = cloneState(state);
      }
      if (!replayFailed) this.state = state;
    } else {
      this.state.pos = corrected.pos;
      this.state.vel = corrected.vel;
      this.state.onGround = corrected.onGround;
      this.history = [];
    }
    this.lastServerPosition = { ...position };
    this.lastServerPositionAt = Date.now();
    this.corrections++;
    this.lastCorrection = { tick: tickValue == null ? null : String(tickValue), position: { ...position },
      velocity: { x: corrected.vel.x, y: corrected.vel.y, z: corrected.vel.z },
      onGround: corrected.onGround, replayed: index >= 0 ? this.history.length - index - 1 : 0 };
    if (!replayFailed) this.lastMovementResult = { status: 'reconciled', reason: 'server_prediction_correction' };
  }

  knockback(packet) {
    if (!packet?.velocity || !this.state) return;
    const velocity = packet.velocity;
    const targetTick = packet.tick != null ? BigInt(packet.tick) + 1n : null;
    const index = targetTick == null ? -1 : this.history.findIndex(entry => entry.tick === targetTick);
    const motion = new Vec3(velocity.x, velocity.y, velocity.z);
    if (index >= 0) {
      this.history[index].input.knockback = motion.clone();
      let state = cloneState(index > 0 ? this.history[index - 1].state : this.history[index].state);
      const start = index > 0 ? index : index + 1;
      if (index === 0) {
        state.vel = motion.clone();
        this.history[0].state.vel = motion.clone();
      }
      for (let i = start; i < this.history.length; i++) {
        const entry = this.history[i];
        this.applyInput(state, entry.input);
        if (entry.input.knockback) state.vel = entry.input.knockback.clone();
        this.physicsWorld.beginTick();
        this.physics.simulatePlayer(state, this.physicsWorld);
        if (this.physicsWorld.unknown) {
          this.state.vel = motion;
          this.lastMovementResult = { status: 'unavailable', reason: 'terrain_not_fully_observed' };
          return;
        }
        entry.state = cloneState(state);
      }
      this.state = state;
    } else {
      this.state.vel = motion;
    }
  }

  resetSession() {
    this.releaseManual();
    this.inputQueue.stop();
    this.started = false;
    this.world = null;
    this.state = null;
    this.history = [];
    this.previousInput = null;
    this.lastServerPosition = null;
    this.lastServerPositionAt = null;
    this.lastServerTick = null;
    this.physics = null;
    this.physicsWorld = null;
    this.collisionData = null;
  }

  stop(reason = 'stopped') {
    this.releaseManual();
    if (['session_closed', 'player_died', 'movement_authority_changed',
         'dimension_changed', 'world_closed'].includes(reason)) {
      this.inputQueue.stop();
      this.started = false;
    }
    this.lastMovementResult = { status: 'idle', reason };
  }

  snapshot() {
    return {
      available: this.capability() === 'ready',
      capability: this.capability(),
      state: this.started ? 'running' : 'stopped',
      framesSent: this.framesSent,
      corrections: this.corrections,
      lastCorrection: this.lastCorrection,
      lastInput: this.lastInput,
      lastMovementResult: this.lastMovementResult,
      physics: this.collisionData ? { blocks: this.collisionData.blockCount, states: this.collisionData.stateCount } : null,
      terrain: this.physicsWorld ? { unknown: this.physicsWorld.unknown, queries: this.physicsWorld.queries } : null
    };
  }
}

module.exports = { BedrockMovementController };
