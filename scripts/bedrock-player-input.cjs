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
  constructor(client, enabled = false) {
    this.client = client;
    this.enabled = enabled === true;
    this.timer = null;
    this.lastTick = null;
    this.predicted = null;
    this.remaining = 0;
    this.errors = 0;
    this.world = null;
    this.lastYaw = 0;
  }
  capability(world) {
    if (!this.enabled || typeof this.client.queue !== 'function') return 'unavailable';
    if (!world || !world.spawned || !world.position || !world.self ||
      ![1, 2].includes(world.movementAuthority) || world.serverTick == null ||
      world.receivedChunks.size === 0 ||
      world.lastServerPositionAt == null ||
      world.clock() - world.lastServerPositionAt > MAX_FRESH_MS) return 'unavailable';
    return 'experimental';
  }
  probeStep(world) {
    if (this.capability(world) !== 'experimental') return { status: 'rejected', reason: 'movement_unavailable' };
    if (this.timer) return { status: 'rejected', reason: 'movement_busy' };
    this.remaining = PROBE_TICKS;
    this.predicted = { ...world.position };
    this.lastTick = world.serverTick;
    this.world = world;
    const yaw = Number.isFinite(world.yaw) ? world.yaw : 0;
    this.lastYaw = yaw;
    const send = () => {
      if (!this.timer) return;
      if (this.remaining <= 0) { this.stop(); return; }
      if (world.closed || !world.spawned) { this.stop(); return; }
      try {
        const nextTick = this.lastTick + 1n;
        const packet = buildInputPacket(this.predicted, yaw, nextTick, true);
        this.client.queue('player_auth_input', packet);
        this.lastTick = nextTick;
        this.predicted = packet.position;
        this.remaining--;
      } catch {
        this.errors++;
        this.stop();
      }
    };
    this.timer = setInterval(send, INPUT_TICK_MS);
    return { status: 'accepted', reason: 'experimental_input_queued_not_verified' };
  }
  correct(position, tick) {
    if (!this.timer) return;
    if (finite3(position)) this.predicted = { ...position };
    if (typeof tick === 'bigint' && tick > (this.lastTick ?? -1n)) this.lastTick = tick;
  }
  stop() {
    const hadTimer = this.timer != null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.remaining = 0;
    // Send a single neutral frame on explicit stop / after the bounded pulse,
    // not after a dimension switch or connection closure.
    if (hadTimer && this.world && !this.world.closed && this.world.spawned &&
        this.world.position && this.predicted && this.lastTick != null) {
      try {
        this.client.queue('player_auth_input',
          buildInputPacket(this.predicted, this.lastYaw, this.lastTick + 1n, false));
      } catch { this.errors++; }
    }
    this.predicted = null;
    this.world = null;
  }
}

module.exports = { ExperimentalPlayerInput, buildInputPacket };
