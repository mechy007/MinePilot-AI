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
const COMMAND_ACTIONS = new Set(['status', 'inspect', 'wait', 'stay', 'set_home', 'plan_follow', 'plan_return', 'plan_collect', 'inspect_block', 'plan_food', 'plan_shelter', 'plan_craft_planks', 'plan_workflow', 'review_checkpoint', 'advisor_mode', 'advisor_review', 'stop_movement', 'probe_step', 'motion_diagnostic']);
const finitePosition = value => value && typeof value === 'object' &&
  ['x', 'y', 'z'].every(key => typeof value[key] === 'number' &&
    Number.isFinite(value[key]) && Math.abs(value[key]) <= 30_000_000);
const ident = id => id == null ? null : String(id);
const safePoint = point => finitePosition(point)
  ? Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, Math.round(point[axis] * 1000) / 1000]))
  : null;
const validDimension = value => {
  // The pinned 1.26.60 StartGame schema decodes a string enum, while ChangeDimension uses integers.
  const normalized = typeof value === 'string'
    ? ({ overworld: 0, nether: 1, end: 2 })[value] : value;
  return Number.isInteger(normalized) && normalized >= 0 && normalized <= 2 ? normalized : null;
};
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
    this.layerTwo = options.layerTwo ?? null;
    this.layerThree = options.layerThree ?? null;
    this.layerFour = options.layerFour ?? null;
    this.layerFive = options.layerFive ?? null;
    this.layerSix = options.layerSix ?? null;
    this.layerSeven = options.layerSeven ?? null;
    this.layerEight = options.layerEight ?? null;
    this.addonNavigation = options.addonNavigation ?? null;
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
    this.playerNames = new Map();
    this.corrections = 0;
    this.lastWorldAt = null;
    this.lastServerPositionAt = null;
    this.lastReceipt = null;
    this.playerGameMode = 'unknown';
    this.worldGameMode = 'unknown';
    this.difficulty = null;
    this.spawnTrace = { respawnSeen: 0, respawnAcknowledged: 0,
      loadingCompleted: false, loadingPacketsSent: 0, handshakeErrors: 0 };
    this.lastRespawnState = null;
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
    this.bind('spawn', () => this.onSpawn());
    this.bind('respawn', p => this.onRespawn(p));
    this.bind('set_player_game_type', p => this.gameModeChange(p));
    this.bind('update_player_game_type', p => this.gameModeChange(p));
    this.bind('set_movement_authority', p => this.authorityChange(p));
    this.bind('level_chunk', p => this.chunk(p));
    this.bind('move_player', p => this.move(p));
    this.bind('correct_player_move_prediction', p => this.correction(p));
    this.bind('inventory_content', p => {
      this.layerOne?.onInventory(p);
      this.layerThree?.observeInventory(p);
      this.layerFour?.observeInventory(this.layerThree?.inventoryItems() ?? { known: false, observedAt: null, counts: {} });
      this.layerFive?.observeInventory(this.layerThree?.inventoryItems() ?? { known: false, observedAt: null, counts: {} });
      this.layerSix?.observeContainer(p);
    });
    this.bind('item_registry', p => {
      this.layerThree?.observeItemRegistry(p);
      this.layerFour?.observeInventory(this.layerThree?.inventoryItems() ?? { known: false, observedAt: null, counts: {} });
      this.layerFive?.observeInventory(this.layerThree?.inventoryItems() ?? { known: false, observedAt: null, counts: {} });
    });
    this.bind('set_time', p => this.layerFour?.observeTime(p?.time));
    this.bind('update_block', p => {
      this.layerThree?.observeBlock(p, this.dimension);
      this.layerFive?.observeBlockUpdate(p, this.dimension);
      this.layerSix?.observeBlock(p, this.dimension);
    });
    this.bind('add_item_entity', p => this.layerThree?.observeDrop(p, this.dimension));
    this.bind('take_item_entity', p => this.layerThree?.observeTake(p, this.self));
    this.bind('update_attributes', p => this.attributes(p));
    this.bind('add_player', p => this.addPlayer(p));
    this.bind('player_list', p => this.playerList(p));
    this.bind('mob_equipment', p => this.equipment(p));
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
    this.selfUnique = ident(packet.entity_id);
    this.position = safePoint(packet.player_position);
    const startRotation = packet.rotation;
    this.pitch = Number.isFinite(startRotation?.x) ? startRotation.x : null;
    this.yaw = Number.isFinite(startRotation?.z) ? startRotation.z :
      Number.isFinite(startRotation?.y) ? startRotation.y : null;
    this.lastServerPositionAt = this.position ? this.clock() : null;
    this.dimension = validDimension(packet.dimension);
    this.playerGameMode = this.modeName(packet.player_gamemode);
    this.worldGameMode = this.modeName(packet.world_gamemode);
    this.difficulty = Number.isInteger(packet.difficulty) && packet.difficulty >= 0 &&
      packet.difficulty <= 3 ? packet.difficulty : null;
    this.spawnTrace = { respawnSeen: 0, respawnAcknowledged: 0,
      loadingCompleted: false, loadingPacketsSent: 0, handshakeErrors: 0 };
    this.lastRespawnState = null;
    const authority = packet.movement_authority;
    this.movementAuthority = Number.isInteger(authority) ? authority :
      ({ client: 0, server: 1, server_with_rewind: 2 })[authority] ?? null;
    this.serverTick = validTick(packet.current_tick);
    this.players.clear();
    this.receivedChunks.clear();
    this.lastWorldAt = this.clock();
    this.spawned = false;
    if (typeof this.movement?.resetSession === 'function') this.movement.resetSession();
    else this.movement?.stop();
    this.layerOne?.reset();
    this.layerTwo?.reset();
    this.layerThree?.reset();
    this.layerFour?.reset();
    this.layerFive?.reset();
    this.layerSix?.reset();
    this.layerSeven?.reset();
    this.addonNavigation?.reset();
    if (Number.isInteger(packet.time)) this.layerFour?.observeTime(packet.time);
    this.playerNames.clear();
    if (this.position) this.layerOne?.onServerPosition(this.position);
  }
  modeName(mode) {
    if (typeof mode === 'number' && Number.isInteger(mode))
      mode = ({ 0: 'survival', 1: 'creative', 2: 'adventure',
        3: 'survival_spectator', 4: 'creative_spectator',
        5: 'fallback', 6: 'spectator' })[mode];
    return ['survival', 'creative', 'adventure','survival_spectator',
      'creative_spectator','fallback','spectator'].includes(mode) ? mode : 'unknown';
  }
  gameModeChange(packet) {
    if (this.closed) return;
    // set_player_game_type is local-player only; update_player_game_type carries
    // a player unique id. Never attribute another player's game mode to ours.
    if (packet?.player_unique_id != null && this.selfUnique != null &&
      ident(packet.player_unique_id) !== this.selfUnique) return;
    if (packet?.player_unique_id != null && this.selfUnique == null) return;
    const next = this.modeName(packet?.gamemode);
    if (next !== 'unknown') this.playerGameMode = next;
  }
  onRespawn(packet) {
    if (this.closed || !packet || !Number.isInteger(packet.state)) return;
    const incomingId = ident(packet.runtime_entity_id);
    if (incomingId && this.self && incomingId !== this.self) return;
    this.spawnTrace.respawnSeen++;
    this.lastRespawnState = packet.state;
    if (packet.state !== 1 || !this.self || typeof this.client.queue !== 'function') return;
    // Bedrock respawn handshake: ack server state 1 with state 2.
    // Never assume this proves that the host registered an active player.
    try {
      this.client.queue('respawn', { state: 2,
        position: finitePosition(packet.position) ? packet.position : this.position,
        runtime_entity_id: BigInt(this.self) });
      this.spawnTrace.respawnAcknowledged++;
      if (finitePosition(packet.position)) {
        this.position = safePoint(packet.position);
        this.lastServerPositionAt = this.clock();
        this.layerOne?.onServerPosition(this.position);
      }
    } catch { this.spawnTrace.handshakeErrors++; }
  }
  onSpawn() {
    if (this.closed) return;
    this.spawned = true;
    // Player initialization is handled by bedrock-protocol's autoInitPlayer.
    // Bedrock Dedicated Server 1.26.x can require both loading-screen closure
    // packets before simulating movement. Send exactly once per dimension.
    if (this.spawnTrace.loadingCompleted || typeof this.client.queue !== 'function') return;
    try {
      this.client.queue('serverbound_loading_screen', { type: 1 });
      this.spawnTrace.loadingPacketsSent++;
      this.client.queue('serverbound_loading_screen', { type: 2 });
      this.spawnTrace.loadingPacketsSent++;
      this.spawnTrace.loadingCompleted = true;
    } catch { this.spawnTrace.handshakeErrors++; }
  }
  authorityChange(packet) {
    if (this.closed) return;
    const authority = packet?.movement_authority;
    const next = Number.isInteger(authority) && authority >= 0 && authority <= 2 ? authority :
      ({ client: 0, server: 1, server_with_rewind: 2 })[authority] ?? null;
    if (next === null) return;
    if (this.movementAuthority !== next) {
      // Changing movement prediction authority invalidates the active writer.
      this.movement?.stop?.('movement_authority_changed', { silent: true });
      this.movementAuthority = next;
    }
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
      if (attr.name === 'minecraft:player.air_supply' || attr.name === 'minecraft:air_supply') values.air = attr.current;
    }
    const firstWarning = this.layerOne?.onVitals(values);
    const survival = this.layerFour?.observeVitals(values);
    if (firstWarning || survival?.becameCritical || this.layerFour?.critical) this.movement?.stop();
  }
  gameplayWorld() {
    return { position: this.position, dimension: this.dimension, spawned: this.spawned,
      chunks: this.receivedChunks.size,
      safetyHold: (this.layerOne?.snapshot()?.safetyHold ?? false) || (this.layerFour?.critical ?? false) };
  }
  readinessInput() {
    const age = this.lastServerPositionAt == null ? null :
      Math.max(0, this.clock() - this.lastServerPositionAt);
    return {
      spawned: this.spawned, hasSelfEntity: this.self != null,
      hasPosition: this.position !== null, positionAgeMs: age,
      receivedChunkHeaders: this.receivedChunks.size,
      movementAuthority: this.movementAuthority,
      blocksDecoded: false,
      movementCorrections: this.corrections, sessionClosed: this.closed
    };
  }
  advisorWorld() {
    const world = this.gameplayWorld();
    const survival = this.layerFour?.snapshot();
    return {
      spawned: world.spawned, positionKnown: world.position !== null,
      chunks: world.chunks, safetyHold: world.safetyHold,
      survivalLevel: survival?.level ?? 'unknown',
      survivalReason: survival?.reason ?? 'unavailable',
      foodOptions: survival?.foodOptions?.length ?? 0,
      taskStatus: survival?.taskStatus ?? 'none',
      followStatus: this.layerTwo?.preview(world).status ?? 'idle',
      resourceStatus: this.layerThree?.preview(world).status ?? 'idle',
      buildStatus: this.layerFive?.snapshot(world).state ?? 'idle',
      workflowStatus: this.layerSix?.snapshot(world).state ?? 'idle',
      playerGameMode: this.playerGameMode === 'fallback' ? this.worldGameMode : this.playerGameMode,
      loadingPacketsSent: this.spawnTrace?.loadingPacketsSent ?? 0,
      loadingErrors: this.spawnTrace?.handshakeErrors ?? 0,
      movementAuthority: this.movementAuthority,
      isNight: survival?.isNight ?? null
    };
  }
  playerList(packet) {
    if (this.closed || !packet || typeof packet !== 'object') return;
    // Bedrock PlayerRecords is sometimes a nested tagged union, not a flat array.
    const payload = packet.records ?? packet.entries;
    const entries = Array.isArray(payload) ? payload :
      payload && typeof payload === 'object'
        ? (Array.isArray(payload.records) ? payload.records : payload.entries)
        : null;
    if (!Array.isArray(entries)) return;
    // Only sanitized player names and UUIDs are cached.
    const action = packet.action_type ?? packet.action ?? payload?.type ?? payload?.action;
    const removal = action === 'remove' || action === 1;
    for (const p of entries.slice(0, MAX_VISIBLE_PLAYERS)) {
      const uuid = typeof p.uuid === 'string' ? p.uuid : null;
      if (!uuid || uuid.length > 64) continue;
      if (removal) { this.playerNames.delete(uuid); continue; }
      const name = p.username;
      if (typeof name !== 'string' || !/^[a-zA-Z0-9_ #.-]{1,32}$/.test(name)) continue;
      if (this.playerNames.size >= MAX_VISIBLE_PLAYERS && !this.playerNames.has(uuid)) continue;
      this.playerNames.set(uuid, name);
    }
  }
  equipment(packet) {
    if (this.closed || ident(packet?.runtime_entity_id ?? packet?.runtime_id) !== this.self) return;
    this.layerTwo?.observeEquipment(packet?.slot, packet?.item?.network_id ?? packet?.item?.id ?? null);
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
      this.movement?.observeServerPosition?.(pos, this.clock());
      if (Number.isFinite(packet.yaw)) this.yaw = packet.yaw;
      if (Number.isFinite(packet.pitch)) this.pitch = packet.pitch;
    } else if (this.players.has(id)) {
      this.players.get(id).position = pos;
      this.players.get(id).seenAt = this.clock();
      this.layerTwo?.movePlayer(id, pos);
      this.layerThree?.moveDrop(id, pos);
    }
  }
  correction(packet) {
    if (this.closed || !packet) return;
    const pos = safePoint(packet.position);
    if (!pos || this.self == null) return;
    this.position = pos;
    this.lastServerPositionAt = this.clock();
    this.corrections++;
    if (Number.isFinite(packet.rotation?.x)) this.pitch = packet.rotation.x;
    if (Number.isFinite(packet.rotation?.z)) this.yaw = packet.rotation.z;
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
    const uuid = typeof packet.uuid === 'string' ? packet.uuid : null;
    const name = typeof packet.username === 'string' ? packet.username : this.playerNames.get(uuid);
    this.layerTwo?.observePlayer(id, name, position, this.dimension);
  }
  removeActor(packet) {
    if (!packet) return;
    const id = ident(packet.entity_id_self ?? packet.entity_id ?? packet.runtime_entity_id ?? packet.runtime_id);
    if (id) {
      this.players.delete(id);
      this.layerTwo?.removePlayer(id);
      this.layerThree?.removeEntity(id);
    }
  }
  dimensionChange(packet) {
    if (this.closed) return;
    this.dimension = validDimension(packet?.dimension);
    this.position = null;
    this.lastServerPositionAt = null;
    this.serverTick = null;
    this.spawned = false;
    this.spawnTrace = { respawnSeen: 0, respawnAcknowledged: 0,
      loadingCompleted: false, loadingPacketsSent: 0, handshakeErrors: 0 };
    this.receivedChunks.clear();
    this.players.clear();
    if (typeof this.movement?.resetSession === 'function') this.movement.resetSession();
    else this.movement?.stop();
    this.layerOne?.reset();
    this.layerTwo?.dimensionChanged();
    this.layerThree?.dimensionChanged();
    this.layerFour?.dimensionChanged();
    this.layerFive?.dimensionChanged();
    this.layerSix?.dimensionChanged();
    this.layerSeven?.reset();
    this.addonNavigation?.reset();
    this.playerNames.clear();
  }
  updateAddonNavigation() {
    if (!this.addonNavigation) return null;
    const preview = this.layerTwo?.preview(this.gameplayWorld());
    if (preview?.status === 'route_unverified' && preview.nextPoint) {
      this.addonNavigation.request('follow', 'walk', preview.nextPoint, 1000);
    } else {
      this.addonNavigation.release('follow');
    }
    return this.addonNavigation.update({
      position: this.position,
      dimension: this.dimension,
      observedAt: this.lastServerPositionAt ?? -1,
      collisionVerified: false,
      safetyHold: this.layerFour?.critical === true ||
        this.layerOne?.snapshot()?.safetyHold === true
    });
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
      serverGameMode: this.playerGameMode === 'fallback' ? this.worldGameMode : this.playerGameMode,
      playerGameMode: this.playerGameMode,
      worldGameMode: this.worldGameMode,
      difficulty: this.difficulty,
      spawnHandshake: { ...this.spawnTrace, lastRespawnState: this.lastRespawnState },
      movement: this.movement?.capability?.(this) ?? 'unavailable',
      ...(this.movement?.snapshot ? { motionDiagnostic: this.movement.snapshot() } : {}),
      ...(this.layerOne ? { layerOne: this.layerOne.snapshot() } : {}),
      ...(this.layerTwo ? { layerTwo: this.layerTwo.snapshot(this.gameplayWorld()) } : {}),
      ...(this.layerThree ? { layerThree: this.layerThree.snapshot(this.gameplayWorld()) } : {}),
      ...(this.layerFour ? { layerFour: this.layerFour.snapshot() } : {}),
      ...(this.layerFive ? { layerFive: this.layerFive.snapshot(this.gameplayWorld()) } : {}),
      ...(this.layerSix ? { layerSix: this.layerSix.snapshot(this.gameplayWorld()) } : {}),
      ...(this.layerSeven ? { layerSeven: this.layerSeven.snapshot(this.advisorWorld()) } : {}),
      ...(this.layerEight ? { layerEight: this.layerEight.assess(this.readinessInput()) } : {}),
      ...(this.addonNavigation ? { addonNavigation: this.updateAddonNavigation() } : {}),
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
    // Layer 8 enforces a fresh authenticated world for *new* plans.
    // Stop, status and disabling suggestions remain possible when stale.
    if (this.layerEight && [
      'plan_follow', 'plan_return', 'plan_collect', 'inspect_block', 'plan_food',
      'plan_shelter', 'plan_craft_planks', 'plan_workflow', 'review_checkpoint'
    ].includes(raw.action)) {
      const preflight = this.layerEight.allowPreview(this.readinessInput());
      if (!preflight.allowed)
        return { status: 'rejected', reason: preflight.reason };
    }
    if (raw.action === 'status') return { status: 'ok', reason: 'snapshot_available' };
    if (raw.action === 'inspect') {
      return this.layerOne?.inspect({ position: this.position, chunks: this.receivedChunks.size, spawned: this.spawned })
        ?? { status: 'rejected', reason: 'layer_one_unavailable' };
    }
    if (raw.action === 'advisor_mode') {
      if (!this.spawned) return { status: 'rejected', reason: 'world_not_ready' };
      return this.layerSeven?.setMode(raw.mode)
        ?? { status: 'rejected', reason: 'advisor_unavailable' };
    }
    if (raw.action === 'advisor_review') {
      return this.layerSeven?.review(this.advisorWorld())
        ?? { status: 'rejected', reason: 'advisor_unavailable' };
    }
    if (raw.action === 'review_checkpoint') {
      return this.layerSix?.reviewCheckpoint(raw.checkpoint, this.gameplayWorld())
        ?? { status: 'rejected', reason: 'layer_six_unavailable' };
    }
    if (raw.action === 'plan_workflow') {
      const result = this.layerSix?.plan(raw.workflowKind, this.gameplayWorld())
        ?? { status: 'rejected', reason: 'layer_six_unavailable' };
      if (result.status === 'accepted') {
        this.movement?.stop?.();
        this.layerOne?.stop('workflow_selected');
        this.layerTwo?.cancel();
        this.layerThree?.cancel();
        this.layerFive?.cancel();
        this.layerFour?.setTask('workflow');
      }
      return result;
    }
    if (raw.action === 'plan_shelter' || raw.action === 'plan_craft_planks') {
      const result = raw.action === 'plan_shelter'
        ? this.layerFive?.planShelter(raw.material, this.gameplayWorld())
        : this.layerFive?.planCraftPlanks(raw.material, raw.count, this.gameplayWorld());
      if (!result) return { status: 'rejected', reason: 'layer_five_unavailable' };
      if (result.status === 'accepted') {
        // The planner replaces competing goal previews, NOT blocks or inventory.
        this.movement?.stop?.();
        this.layerOne?.stop('build_plan_selected');
        this.layerTwo?.cancel();
        this.layerThree?.cancel();
        this.layerFour?.setTask(raw.action === 'plan_shelter' ? 'build' : 'craft');
        this.layerSix?.cancel();
      }
      return result;
    }
    if (raw.action === 'plan_food') {
      return this.layerFour?.planFood()
        ?? { status: 'rejected', reason: 'layer_four_unavailable' };
    }
    if (raw.action === 'set_home') {
      return this.layerTwo?.markHome(this.gameplayWorld())
        ?? { status: 'rejected', reason: 'layer_two_unavailable' };
    }
    if (raw.action === 'plan_collect' || raw.action === 'inspect_block') {
      const result = raw.action === 'plan_collect'
        ? this.layerThree?.planCollect(raw.itemName, raw.count, this.gameplayWorld())
        : this.layerThree?.planInspectBlock(this.gameplayWorld());
      if (!result) return { status: 'rejected', reason: 'layer_three_unavailable' };
      if (result.status === 'accepted') {
        // Observation-only resource tasks never issue action or movement packets.
        this.movement?.stop?.();
        this.layerOne?.stop('resource_goal_selected');
        this.layerTwo?.cancel();
        this.layerFour?.setTask('collect');
        this.layerFive?.cancel();
        this.layerSix?.cancel();
      }
      return result;
    }
    if (raw.action === 'plan_follow' || raw.action === 'plan_return') {
      const result = raw.action === 'plan_follow'
        ? this.layerTwo?.follow(raw.playerName, this.gameplayWorld())
        : this.layerTwo?.returnHome(this.gameplayWorld());
      if (!result) return { status: 'rejected', reason: 'layer_two_unavailable' };
      if (result.status === 'accepted') {
        // A new plan replaces Stay, but never automatically emits a movement packet.
        this.movement?.stop?.();
        this.layerOne?.stop('new_navigation_plan');
        this.layerThree?.cancel();
        this.layerFour?.setTask(raw.action === 'plan_follow' ? 'follow' : 'return');
        this.layerFive?.cancel();
        this.layerSix?.cancel();
      }
      return result;
    }
    if (raw.action === 'stay') {
      if (!this.spawned) return { status: 'rejected', reason: 'world_not_ready' };
      this.movement?.stop?.();
      const result = this.layerOne?.wait() ?? { status: 'rejected', reason: 'layer_one_unavailable' };
      if (result.status === 'accepted') {
        this.layerTwo?.stay();
        this.layerThree?.cancel();
        this.layerFour?.cancel();
        this.layerFive?.cancel();
        this.layerSix?.cancel();
      }
      return result;
    }
    if (raw.action === 'wait') {
      if (!this.spawned) return { status: 'rejected', reason: 'world_not_ready' };
      this.movement?.stop();
      const result = this.layerOne?.wait() ?? { status: 'rejected', reason: 'layer_one_unavailable' };
      if (result.status === 'accepted') {
        this.layerTwo?.stay();
        this.layerThree?.cancel();
        this.layerFour?.cancel();
        this.layerFive?.cancel();
        this.layerSix?.cancel();
      }
      return result;
    }
    if (raw.action === 'stop_movement') {
      this.layerOne?.stop();
      this.layerTwo?.cancel();
      this.layerThree?.cancel();
      this.layerFour?.cancel();
      this.layerFive?.cancel();
      this.layerSix?.cancel();
      this.layerSeven?.setMode('off');
      this.addonNavigation?.emergencyStop();
      this.movement?.stop?.();
      return { status: 'ok', reason: 'movement_cancelled' };
    }
    if (raw.action === 'motion_diagnostic') {
      if (this.layerOne?.snapshot()?.safetyHold)
        return { status: 'rejected', reason: 'critical_health' };
      if (this.layerFour?.critical)
        return { status: 'rejected', reason: 'survival_hold' };
      const activeFollow = this.layerTwo?.preview(this.gameplayWorld());
      if (activeFollow && ['follow', 'return'].includes(activeFollow.goal))
        return { status: 'rejected', reason: 'planned_navigation_not_executable' };
      if (this.layerThree && this.layerThree.snapshot(this.gameplayWorld()).route.status !== 'idle')
        return { status: 'rejected', reason: 'resource_goal_not_executable' };
      if (this.layerFive && this.layerFive.snapshot(this.gameplayWorld()).kind !== 'none')
        return { status: 'rejected', reason: 'building_plan_not_executable' };
      if (this.layerSix && this.layerSix.snapshot(this.gameplayWorld()).kind !== 'none')
        return { status: 'rejected', reason: 'workflow_not_executable' };
      if (raw.confirmed !== true)
        return { status: 'rejected', reason: 'confirmation_required' };
      if (this.layerEight && !this.layerEight.allowPreview(this.readinessInput()).allowed)
        return { status: 'rejected', reason: 'server_position_stale' };
      if (!this.movement || this.movement.capability(this) !== 'experimental' ||
          typeof this.movement.runDiagnostic !== 'function')
        return { status: 'rejected', reason: 'movement_unavailable' };
      // Diagnostic only: deliberately no pathfinder, auto-follow, sprint or block actions.
      return this.movement.runDiagnostic(this, { mode: raw.mode, ticks: raw.ticks });
    }
    if (raw.action === 'probe_step') {
      if (this.layerOne?.snapshot()?.safetyHold)
        return { status: 'rejected', reason: 'critical_health' };
      if (this.layerFour?.critical)
        return { status: 'rejected', reason: 'survival_hold' };
      // A raw forward diagnostic is not execution of a Follow or Return plan.
      const plan = this.layerTwo?.preview(this.gameplayWorld());
      if (plan && (plan.goal === 'follow' || plan.goal === 'return'))
        return { status: 'rejected', reason: 'planned_navigation_not_executable' };
      const resourcePlanState = this.layerThree?.snapshot(this.gameplayWorld()).route.status;
      if (resourcePlanState && resourcePlanState !== 'idle')
        return { status: 'rejected', reason: 'resource_goal_not_executable' };
      if (this.layerFive?.snapshot(this.gameplayWorld()).kind !== undefined &&
          this.layerFive.snapshot(this.gameplayWorld()).kind !== 'none')
        return { status: 'rejected', reason: 'building_plan_not_executable' };
      if (this.layerSix?.snapshot(this.gameplayWorld()).kind !== undefined &&
          this.layerSix.snapshot(this.gameplayWorld()).kind !== 'none')
        return { status: 'rejected', reason: 'workflow_not_executable' };
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
    this.layerTwo?.reset();
    this.layerThree?.reset();
    this.layerFour?.reset();
    this.layerFive?.reset();
    this.layerSix?.reset();
    this.layerSeven?.reset();
    this.addonNavigation?.reset();
    this.playerNames.clear();
    for (const [event, callback] of this.listeners) this.client.removeListener(event, callback);
    this.listeners = [];
    this.players.clear();
    this.receivedChunks.clear();
  }
}

module.exports = { BedrockGameplayBridge, finitePosition, safePoint, validTick };
