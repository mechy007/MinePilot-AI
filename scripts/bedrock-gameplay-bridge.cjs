'use strict';

/**
 * Live Bedrock gameplay session mirror and private, single-command IPC.
 * Uses the SAME client as the Xbox/NetherNet Android friend-world runner.
 * Source is original; no Minecraft addon implementation is embedded.
 */
const { readFileSync, writeFileSync, renameSync, unlinkSync, statSync } = require('node:fs');
const { randomUUID } = require('node:crypto');

const MAX_COMMAND_BYTES = 2048;
const MAX_VISIBLE_PLAYERS = 64;
const MAX_CHUNKS = 128;
const COMMAND_ACTIONS = new Set(['status', 'inspect', 'wait', 'stop_movement', 'probe_step']);
const finitePosition = value => value && typeof value === 'object' &&
  ['x', 'y', 'z'].every(key => typeof value[key] === 'number' &&
    Number.isFinite(value[key]) && Math.abs(value[key]) <= 30_000_000);
const ident = id => id == null ? null : String(id);
const safePoint = point => finitePosition(point)
  ? Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, Math.round(point[axis] * 1000) / 1000]))
  : null;
const validDimension = value => Number.isInteger(value) && value >= -1 && value <= 2 ? value : null;
const validTick = value => {
  try {
    const tick = BigInt(value ?? -1);
    return tick >= 0n && tick <= 18446744073709551615n ? tick : null;
  } catch { return null; }
};

function atomicJson(file, obj) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temp, JSON.stringify(obj), { flag: 'wx', mode: 0o600 });
    renameSync(temp, file);
  } catch (error) {
    try { unlinkSync(temp); } catch {}
    throw error;
  }
}

class BedrockGameplayBridge {
  constructor(client, options = {}) {
    if (!client || typeof client.on !== 'function' || typeof client.removeListener !== 'function') {
      throw new TypeError('Bedrock client is required');
    }
    this.client = client;
    this.commandPath = options.commandPath ?? null;
    this.receiptPath = options.receiptPath ?? null;
    this.movement = options.movement ?? null;
    this.layerOne = options.layerOne ?? null;
    this.clock = options.clock ?? Date.now;
    this.spawned = false;
    this.closed = false;
    this.self = null;
    this.position = null;
    this.yaw = null;
    this.pitch = null;
    this.dimension = null;
    this.movementAuthority = null;
    this.serverTick = null;
    this.receivedChunks = new Map();
    this.players = new Map();
    this.corrections = 0;
    this.lastWorldAt = null;
    this.lastServerPositionAt = null;
    this.lastReceipt = null;
    this.watch = null;
    this.listeners = [];
  }
  bind(event, callback) {
    this.client.on(event, callback);
    this.listeners.push([event, callback]);
  }
  start() {
    if (this.closed || this.watch || this.listeners.length) throw new Error('Bridge already used');
    this.bind('start_game', p => this.startGame(p));
    this.bind('spawn', () => { this.spawned = true; });
    this.bind('level_chunk', p => this.chunk(p));
    this.bind('move_player', p => this.move(p));
    this.bind('correct_player_move_prediction', p => this.correction(p));
    this.bind('inventory_content', p => this.layerOne?.onInventory(p));
    this.bind('update_attributes', p => this.attributes(p));
    this.bind('add_player', p => this.addPlayer(p));
    this.bind('remove_actor', p => this.removeActor(p));
    this.bind('remove_entity', p => this.removeActor(p));
    this.bind('change_dimension', p => this.dimensionChange(p));
    this.bind('close', () => this.stop());
    if (this.commandPath && this.receiptPath) this.watch = setInterval(() => this.poll(), 100);
    return this;
  }
  startGame(packet) {
    if (!packet || typeof packet !== 'object') return;
    this.self = ident(packet.runtime_entity_id ?? packet.entity_runtime_id);
    this.position = safePoint(packet.player_position);
    this.lastServerPositionAt = this.position ? this.clock() : null;
    this.dimension = validDimension(packet.dimension);
    const authority = packet.movement_authority;
    this.movementAuthority = Number.isInteger(authority) ? authority :
      ({ client: 0, server: 1, server_with_rewind: 2 })[authority] ?? null;
    this.serverTick = validTick(packet.current_tick);
    this.players.clear();
    this.receivedChunks.clear();
    this.lastWorldAt = this.clock();
    this.spawned = false;
    this.movement?.stop();
    this.layerOne?.reset();
    if (this.position) this.layerOne?.onServerPosition(this.position);
  }
  attributes(packet) {
    const id = ident(packet?.runtime_entity_id ?? packet?.runtime_id);
    if (!id || id !== this.self || !Array.isArray(packet?.attributes)) return;
    const values = {};
    for (const attr of packet.attributes.slice(0, 64)) {
      if (!Number.isFinite(attr?.current)) continue;
      if (attr.name === 'minecraft:health') values.health = attr.current;
      if (attr.name === 'minecraft:player.hunger') values.hunger = attr.current;
      if (attr.name === 'minecraft:player.max_health') values.maxHealth = attr.current;
    }
    if (this.layerOne?.onVitals(values)) this.movement?.stop();
  }
  chunk(packet) {
    if (this.closed || !packet || !Number.isInteger(packet.x) || !Number.isInteger(packet.z)) return;
    if (Math.abs(packet.x) > 1875000 || Math.abs(packet.z) > 1875000) return;
    const dimension = validDimension(packet.dimension) ?? this.dimension ?? 0;
    const key = dimension + ':' + packet.x + ':' + packet.z;
    this.receivedChunks.delete(key);
    this.receivedChunks.set(key, this.clock());
    if (this.receivedChunks.size > MAX_CHUNKS) this.receivedChunks.delete(this.receivedChunks.keys().next().value);
    this.lastWorldAt = this.clock();
  }
  move(packet) {
    if (this.closed || !packet) return;
    const id = ident(packet.runtime_entity_id ?? packet.runtime_id);
    if (!id) return;
    const pos = safePoint(packet.position);
    if (!pos) return;
    if (id === this.self) {
      this.position = pos;
      this.lastServerPositionAt = this.clock();
      this.layerOne?.onServerPosition(pos);
      if (Number.isFinite(packet.yaw)) this.yaw = packet.yaw;
      if (Number.isFinite(packet.pitch)) this.pitch = packet.pitch;
    } else if (this.players.has(id)) {
      this.players.get(id).position = pos;
      this.players.get(id).seenAt = this.clock();
    }
  }
  correction(packet) {
    if (this.closed || !packet) return;
    const pos = safePoint(packet.position);
    if (!pos || this.self == null) return;
    this.position = pos;
    this.lastServerPositionAt = this.clock();
    this.corrections++;
    this.layerOne?.onServerPosition(pos);
    const tick = validTick(packet.tick);
    if (tick !== null && (this.serverTick == null || tick > this.serverTick)) this.serverTick = tick;
    this.movement?.correct?.(pos, tick);
  }
  addPlayer(packet) {
    if (!packet || this.closed) return;
    const id = ident(packet.runtime_entity_id ?? packet.runtime_id);
    if (!id || id === this.self) return;
    if (this.players.size >= MAX_VISIBLE_PLAYERS && !this.players.has(id)) return;
    const position = safePoint(packet.position);
    if (!position) return;
    this.players.set(id, { position, seenAt: this.clock() });
  }
  removeActor(packet) {
    if (!packet) return;
    const id = ident(packet.entity_id ?? packet.runtime_entity_id ?? packet.runtime_id);
    if (id) this.players.delete(id);
  }
  dimensionChange(packet) {
    if (this.closed) return;
    this.dimension = validDimension(packet?.dimension);
    this.position = null;
    this.lastServerPositionAt = null;
    this.serverTick = null;
    this.receivedChunks.clear();
    this.players.clear();
    this.movement?.stop();
    this.layerOne?.reset();
  }
  snapshot() {
    const now = this.clock();
    const age = this.lastServerPositionAt == null ? null : Math.max(0, now - this.lastServerPositionAt);
    return {
      state: this.closed ? 'closed' : this.spawned && this.self && this.position && this.receivedChunks.size
        ? 'observing' : 'awaiting_world',
      position: this.position ? { ...this.position } : null,
      dimension: this.dimension,
      visiblePlayers: this.players.size,
      loadedChunkHeaders: this.receivedChunks.size,
      // A chunk header does NOT prove decoded, navigable block/voxel data.
      blocksDecoded: false,
      serverPositionAgeMs: age,
      correctionCount: this.corrections,
      movementAuthority: this.movementAuthority,
      movement: this.movement?.capability?.(this) ?? 'unavailable',
      ...(this.layerOne ? { layerOne: this.layerOne.snapshot() } : {}),
      ...(this.lastReceipt ? { lastCommand: { ...this.lastReceipt } } : {})
    };
  }
  execute(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      raw.version !== 'minepilot.gameplay.v1' ||
      typeof raw.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(raw.requestId) ||
      !COMMAND_ACTIONS.has(raw.action)) {
      return { status: 'rejected', reason: 'invalid_command' };
    }
    if (this.closed) return { status: 'rejected', reason: 'session_closed' };
    if (raw.action === 'status') return { status: 'ok', reason: 'snapshot_available' };
    if (raw.action === 'inspect') {
      return this.layerOne?.inspect({ position: this.position, chunks: this.receivedChunks.size, spawned: this.spawned })
        ?? { status: 'rejected', reason: 'layer_one_unavailable' };
    }
    if (raw.action === 'wait') {
      if (!this.spawned) return { status: 'rejected', reason: 'world_not_ready' };
      this.movement?.stop();
      return this.layerOne?.wait() ?? { status: 'rejected', reason: 'layer_one_unavailable' };
    }
    if (raw.action === 'stop_movement') {
      this.layerOne?.stop();
      this.movement?.stop?.();
      return { status: 'ok', reason: 'movement_cancelled' };
    }
    if (raw.action === 'probe_step') {
      if (raw.confirmed !== true) return { status: 'rejected', reason: 'confirmation_required' };
      if (raw.direction !== 'forward') return { status: 'rejected', reason: 'unsupported_direction' };
      if (!this.movement || this.movement.capability(this) !== 'experimental') {
        return { status: 'rejected', reason: 'movement_unavailable' };
      }
      const preflight = this.layerOne?.beginProbe({ position: this.position, chunks: this.receivedChunks.size, spawned: this.spawned });
      if (preflight && preflight.status !== 'accepted') return preflight;
      try {
        const result = this.movement.probeStep(this);
        if (result.status === 'accepted') this.layerOne?.probeQueued();
        else this.layerOne?.probeFailed(result.reason);
        return result;
      } catch {
        this.layerOne?.probeFailed('movement_failed');
        return { status: 'rejected', reason: 'movement_failed' };
      }
    }
    return { status: 'rejected', reason: 'unsupported_command' };
  }
  poll() {
    if (this.closed || !this.commandPath || !this.receiptPath) return;
    let data;
    try {
      if (statSync(this.commandPath).size > MAX_COMMAND_BYTES) {
        unlinkSync(this.commandPath);
        return;
      }
      data = readFileSync(this.commandPath, 'utf8');
      unlinkSync(this.commandPath);
    } catch (error) {
      if (error.code !== 'ENOENT') this.lastReceipt = { status: 'rejected', reason: 'inbox_error' };
      return;
    }
    let command;
    try { command = JSON.parse(data); }
    catch { command = null; }
    const result = this.execute(command);
    const receipt = {
      version: 'minepilot.gameplay.v1',
      requestId: typeof command?.requestId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(command.requestId)
        ? command.requestId : '',
      status: result.status,
      reason: result.reason
    };
    this.lastReceipt = receipt;
    try { atomicJson(this.receiptPath, receipt); }
    catch { this.lastReceipt = { status: 'rejected', reason: 'receipt_write_failed' }; }
  }
  stop() {
    if (this.closed) return;
    this.closed = true;
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
    this.movement?.stop?.();
    this.layerOne?.stop('session_closed');
    for (const [event, callback] of this.listeners) this.client.removeListener(event, callback);
    this.listeners = [];
    this.players.clear();
    this.receivedChunks.clear();
  }
}

module.exports = { BedrockGameplayBridge, finitePosition, safePoint, validTick };
