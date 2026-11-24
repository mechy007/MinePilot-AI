'use strict';

/**
 * Live Bedrock gameplay session mirror and private, single-command IPC.
 * Uses the SAME client as the Xbox/NetherNet Android friend-world runner.
 * Source is original; no Minecraft addon implementation is embedded.
 */
const { readFileSync, writeFileSync, renameSync, unlinkSync, statSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { executeBedrockObservation } = require('./bedrock-odyssey-observation-executor.cjs');
const { buildFirstPersonScene } = require('./bedrock-first-person-scene.cjs');
const { gameplaySkillManifest, startLearningTask, stopLearningTask, startLocalAutopilot, stopLocalAutopilot, proposeLearningSkill } = require('./bedrock-skill-manifest.cjs');

const MAX_COMMAND_BYTES = 2048;
const MAX_VISIBLE_PLAYERS = 64;
const MAX_CHUNKS = 128;
const COMMAND_ACTIONS = new Set(['status', 'inspect', 'wait', 'stay', 'set_home', 'plan_follow', 'plan_return', 'plan_collect', 'inspect_block', 'plan_food', 'plan_shelter', 'plan_craft_planks', 'plan_workflow', 'review_checkpoint', 'advisor_mode', 'advisor_review', 'stop_movement', 'probe_step', 'motion_diagnostic', 'autonomy_follow', 'follow_player', 'autonomy_stop', 'agent_start', 'agent_stop', 'verified_step', 'experimental_break', 'learning_start', 'learning_stop', 'learning_propose', 'learning_autopilot_start', 'learning_autopilot_stop', 'odyssey_observe']);
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
    this.terrain = options.terrain ?? null;
    this.routePlanner = options.routePlanner ?? null;
    this.registryResolver = options.registryResolver ?? null;
    this.navigationRoute = null;
    this.autonomy = options.autonomy ?? null;
    this.blockBreaker = options.blockBreaker ?? null;
    this.lifeSenses = options.lifeSenses ?? null;
    this.intelligence = options.intelligence ?? null;
    this.gameplayAgent = options.gameplayAgent ?? null;
    this.clock = options.clock ?? Date.now;
    this.spawned = false;
    this.closed = false;
    this.self = null;
    this.position = null;
    this.yaw = null;
    this.pitch = null;
    this.dimension = null;
    this.movementAuthority = null;
    this.movementAuthoritySource = 'unknown';
    this.serverTick = null;
    this.serverTickObservedAt = null;
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
    this.respawnRecovery = { state: 'alive', deaths: 0, requests: 0,
      actionRequests: 0, recovered: 0, error: null };
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
    this.bind('level_chunk', p => { this.chunk(p); this.terrain?.levelChunk(p); });
    this.bind('subchunk', p => this.terrain?.subChunk(p));
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
      this.blockBreaker?.observedBlock(p, this.dimension);
      this.terrain?.updateBlock(p, this.dimension);
      this.layerThree?.observeBlock(p, this.dimension);
      this.layerFive?.observeBlockUpdate(p, this.dimension);
      this.layerSix?.observeBlock(p, this.dimension);
    });
    this.bind('add_item_entity', p => this.layerThree?.observeDrop(p, this.dimension));
    this.bind('take_item_entity', p => this.layerThree?.observeTake(p, this.self));
    this.bind('update_attributes', p => this.attributes(p));
    this.bind('set_health', p => this.observeHealth(p?.health));

    this.bind('add_player', p => this.addPlayer(p));
    // Passive observation, never assume raw numeric entity types are hostile.
    this.bind('add_actor', p => this.lifeSenses?.observeEntity(p));
    this.bind('move_actor_absolute', p => this.lifeSenses?.moveEntity(p));
    this.bind('move_actor_delta', p => this.lifeSenses?.moveEntity(p));
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
    stopLocalAutopilot(this, 'new_world_session');
    this.gameplayAgent?.stop('new_world_session');
    this.self = ident(packet.runtime_entity_id ?? packet.entity_runtime_id);
    this.selfUnique = ident(packet.entity_id);
    this.position = safePoint(packet.player_position);
    const startRotation = packet.rotation;
    this.pitch = Number.isFinite(startRotation?.x) ? startRotation.x : null;
    this.yaw = Number.isFinite(startRotation?.z) ? startRotation.z :
      Number.isFinite(startRotation?.y) ? startRotation.y : null;
    this.lastServerPositionAt = this.position ? this.clock() : null;
    this.dimension = validDimension(packet.dimension);
    this.terrain?.reset(this.dimension);
    this.intelligence?.reset(this.dimension);
    this.navigationRoute = null;
    if (this.registryResolver && this.terrain) {
      try {
        const mapped = this.registryResolver(packet);
        if (mapped) this.terrain.setRegistry(mapped);
        else this.terrain.setRegistry(new Map());
      } catch { this.terrain.setRegistry(new Map()); }
    }
    this.playerGameMode = this.modeName(packet.player_gamemode);
    this.worldGameMode = this.modeName(packet.world_gamemode);
    this.difficulty = Number.isInteger(packet.difficulty) && packet.difficulty >= 0 &&
      packet.difficulty <= 3 ? packet.difficulty : null;
    this.spawnTrace = { respawnSeen: 0, respawnAcknowledged: 0,
      loadingCompleted: false, loadingPacketsSent: 0, handshakeErrors: 0 };
    this.lastRespawnState = null;
    this.respawnRecovery = { state: 'alive', deaths: 0, requests: 0,
      actionRequests: 0, recovered: 0, error: null };
    // Protocol 1.26.60 uses server-authoritative movement; the old
    // set_movement_authority packet was deprecated in 1.21.90.
    const authority = packet.movement_authority;
    const explicit = Number.isInteger(authority) && [0, 1, 2].includes(authority)
      ? authority : ({ client: 0, server: 1, server_with_rewind: 2 })[authority];
    this.movementAuthority = explicit ??
      (Number.isInteger(packet.rewind_history_size) && packet.rewind_history_size > 0 ? 2 : 1);
    this.movementAuthoritySource = explicit == null ? 'protocol_1_26_default' : 'explicit';
    this.serverTick = validTick(packet.current_tick);
    this.serverTickObservedAt = this.serverTick!=null?this.clock():null;
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
    this.autonomy?.stop('world_reset');
    this.blockBreaker?.abort('world_reset');
    if (Number.isInteger(packet.time)) this.layerFour?.observeTime(packet.time);
    this.playerNames.clear();
    this.lifeSenses?.reset(this.dimension);
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
  observeHealth(health) {
    if (this.closed || !Number.isFinite(health) || !this.self) return;
    if (health <= 0) {
      // Ignore duplicate zero-health updates and initial login fixtures.
      if (!this.spawned || this.respawnRecovery.state !== 'alive') return;
      this.respawnRecovery.state = 'dead_waiting_for_server';
      this.gameplayAgent?.stop('player_died');
      this.respawnRecovery.deaths++;
      this.spawned = false;
      this.autonomy?.stop('player_died');
      this.blockBreaker?.abort('player_died');
      this.movement?.stopPresence?.('player_died');
      this.movement?.stop?.('player_died', {silent:true});
      this.layerTwo?.cancel?.();
      this.addonNavigation?.emergencyStop?.();
      return;
    }
    // Positive health after a confirmed death is the evidence of recovery,
    // not merely seeing a ReadyToSpawn packet.
    if (this.respawnRecovery.state !== 'alive') {
      const recovering = this.respawnRecovery.state;
      if (recovering === 'respawn_action_sent' ||
          recovering === 'client_ready_sent' ||
          recovering === 'dead_waiting_for_server') {
        this.respawnRecovery.recovered++;
        this.respawnRecovery.state = 'alive';
        this.spawned = true;
        this.movement?.startPresence?.(this);
      }
    }
  }
  onRespawn(packet) {
    if (this.closed || !packet || !Number.isInteger(packet.state)) return;
    const incomingId = ident(packet.runtime_entity_id);
    if (incomingId && this.self && incomingId !== this.self) return;
    this.spawnTrace.respawnSeen++;
    this.lastRespawnState = packet.state;
    if (!this.self || typeof this.client.queue !== 'function') return;
    const recovery = this.respawnRecovery;
    const position = finitePosition(packet.position) ? packet.position : this.position;
    if (!finitePosition(position)) {
      this.spawnTrace.handshakeErrors++;
      recovery.error = 'server_respawn_position_unavailable';
      return;
    }
    if (packet.state === 0 && recovery.state === 'dead_waiting_for_server') {
      // Bedrock death handshake: do not reply before the server starts
      // searching. A state-2 reply requests the server's respawn position.
      try {
        this.client.queue('respawn', {
          state: 2, position, runtime_entity_id: BigInt(this.self)
        });
        recovery.requests++;
        recovery.state = 'client_ready_sent';
      } catch {
        this.spawnTrace.handshakeErrors++;
        recovery.error = 'client_ready_write_failed';
      }
      return;
    }
    if (packet.state !== 1) return;
    // Keep existing spawn/join acknowledgement for non-death respawns.
    // The additional player_action below is only for a confirmed death.
    if (recovery.state === 'dead_waiting_for_server' ||
        recovery.state === 'client_ready_sent') {
      try {
        if (recovery.state === 'dead_waiting_for_server') {
          this.client.queue('respawn', {
            state: 2, position, runtime_entity_id: BigInt(this.self)
          });
          recovery.requests++;
        }
        // Protocol 2225 uses the player_action respawn enum. Client-ready
        // alone does not cause the server to revive the player.
        const blockPos = {x:Math.floor(position.x), y:Math.floor(position.y),
          z:Math.floor(position.z)};
        this.client.queue('player_action', {
          runtime_entity_id:BigInt(this.self), action:'respawn',
          position:blockPos, result_position:blockPos, face:0
        });
        recovery.actionRequests++;
        recovery.state = 'respawn_action_sent';
        this.spawnTrace.respawnAcknowledged++;
        this.position = safePoint(position);
        this.lastServerPositionAt = this.clock();
      } catch {
        this.spawnTrace.handshakeErrors++;
        recovery.error = 'respawn_action_write_failed';
      }
      return;
    }
    if (recovery.state !== 'alive') return;
    try {
      this.client.queue('respawn', {
        state: 2, position, runtime_entity_id: BigInt(this.self)
      });
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
    if (this.spawnTrace.loadingCompleted || typeof this.client.queue !== 'function') {
      if (this.spawnTrace.loadingCompleted) this.movement?.startPresence?.(this);
      return;
    }
    try {
      this.client.queue('serverbound_loading_screen', { type: 1 });
      this.spawnTrace.loadingPacketsSent++;
      this.client.queue('serverbound_loading_screen', { type: 2 });
      this.spawnTrace.loadingPacketsSent++;
      this.spawnTrace.loadingCompleted = true;
      // Loading-screen completion is queued before the neutral input stream.
      this.movement?.startPresence?.(this);
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
      this.movementAuthoritySource = 'explicit_authority_update';
      if (this.spawned && [1,2].includes(next)) this.movement?.startPresence?.(this);
      else this.movement?.stopPresence?.('authority_changed');
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
    this.lifeSenses?.observeVitals(values);
    if (values.health !== undefined) this.observeHealth(values.health);
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
      blocksDecoded: (this.terrain?.snapshot().decodedSections ?? 0)>0,
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
      this.lifeSenses?.moveEntity(packet);
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
    if (tick !== null && (this.serverTick == null || tick > this.serverTick)) {
      this.serverTick = tick;
      this.serverTickObservedAt = this.clock();
    }
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
    this.lifeSenses?.observePlayer(id,position);
    const uuid = typeof packet.uuid === 'string' ? packet.uuid : null;
    const name = typeof packet.username === 'string' ? packet.username : this.playerNames.get(uuid);
    this.layerTwo?.observePlayer(id, name, position, this.dimension);
  }
  removeActor(packet) {
    if (!packet) return;
    const id = ident(packet.entity_id_self ?? packet.entity_id ?? packet.runtime_entity_id ?? packet.runtime_id);
    if (id) {
      this.players.delete(id);
      this.lifeSenses?.removeEntity(packet);
      this.layerTwo?.removePlayer(id);
      this.layerThree?.removeEntity(id);
    }
  }
  dimensionChange(packet) {
    if (this.closed) return;
    this.gameplayAgent?.stop('dimension_changed');
    this.dimension = validDimension(packet?.dimension);
    this.terrain?.reset(this.dimension);
    this.navigationRoute = null;
    this.position = null;
    this.lastServerPositionAt = null;
    this.serverTick = null;
    this.serverTickObservedAt = null;
    this.movementAuthority = null;
    this.movementAuthoritySource = 'unknown';
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
    this.autonomy?.stop('dimension_changed');
    this.blockBreaker?.abort('dimension_changed');
    this.playerNames.clear();
    this.respawnRecovery.state = 'alive';
    this.respawnRecovery.error = null;
    this.lifeSenses?.reset(this.dimension);
    this.intelligence?.reset(this.dimension);
  }
  updateAddonNavigation() {
    if (!this.addonNavigation) return null;
    const preview = this.layerTwo?.preview(this.gameplayWorld());
    let route = null;
    if (preview?.status === 'route_unverified' && preview.nextPoint) {
      if(this.terrain && this.routePlanner && this.position && this.dimension!=null) {
        try { route=this.routePlanner(this.terrain,this.dimension,
          this.position,preview.nextPoint); } catch { route=null; }
      }
      if(route?.status==='route_found' && route.waypoint)
        this.addonNavigation.request('follow', 'walk', route.waypoint, 1000);
      else this.addonNavigation.release('follow');
    } else {
      this.addonNavigation.release('follow');
    }
    this.navigationRoute=route;
    return this.addonNavigation.update({
      position: this.position,
      dimension: this.dimension,
      observedAt: this.lastServerPositionAt ?? -1,
      collisionVerified: route?.status==='route_found',
      safetyHold: this.layerFour?.critical === true ||
        this.layerOne?.snapshot()?.safetyHold === true
    });
  }
  intelligenceTick() {
    if (!this.intelligence) return null;
    const life=this.lifeSenses?.snapshot({
      position:this.position,dimension:this.dimension,spawned:this.spawned,
      closed:this.closed,respawnState:this.respawnRecovery.state,terrain:this.terrain
    })??null;
    const age=this.lastServerPositionAt==null?null:Math.max(0,this.clock()-this.lastServerPositionAt);
    const outcome=this.autonomy?.snapshot?.();
    // The planner may record results, but it never claims that queued input
    // means movement succeeded. Only verified host feedback counts.
    if(!this._lastIntelligenceVerified) this._lastIntelligenceVerified=0;
    const verified=Number.isInteger(outcome?.serverVerifiedSteps)?outcome.serverVerifiedSteps:0;
    if(verified<this._lastIntelligenceVerified)this._lastIntelligenceVerified=0;
    if(verified>this._lastIntelligenceVerified)
      for(let i=this._lastIntelligenceVerified;i<Math.min(verified,this._lastIntelligenceVerified+20);i++)
        this.intelligence.noteOutcome('verified');
    this._lastIntelligenceVerified=verified;
    const result=this.intelligence.decide({
      life,position:this.position,dimension:this.dimension,spawned:this.spawned,
      respawnState:this.respawnRecovery.state,positionAgeMs:age,
      terrainReady:(this.terrain?.snapshot()?.decodedSections??0)>0,
      safetyHold:this.gameplayWorld().safetyHold
    });
    if(this.intelligence.shouldEmergencyStop()){
      // A threat or critical health immediately stops *ongoing* unsafe movement;
      // no autonomous retreat/combat is attempted without verified terrain.
      if(this.autonomy?.snapshot?.()?.active) this.autonomy.stop('intelligence_safety_stop');
      this.movement?.stop?.('intelligence_safety_stop',{silent:true});
    }
    return result;
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
      blocksDecoded: (this.terrain?.snapshot().decodedSections ?? 0)>0,
      ...(this.terrain ? { terrain: this.terrain.snapshot() } : {}),
      ...(this.navigationRoute ? { navigationRoute: this.navigationRoute } : {}),
      ...(this.autonomy ? { autonomy: this.autonomy.snapshot() } : {}),
      ...(this.gameplayAgent ? { gameplayAgent: this.gameplayAgent.snapshot() } : {}),
      ...(this.blockBreaker ? { blockBreak: this.blockBreaker.snapshot() } : {}),
      firstPerson: buildFirstPersonScene(this),
      gameplaySkills: gameplaySkillManifest(this),
      ...(this.intelligence ? { intelligence: this.intelligenceTick() } : {}),
      ...(this.lifeSenses ? { life: this.lifeSenses.snapshot({
        position:this.position,dimension:this.dimension,spawned:this.spawned,
        closed:this.closed,respawnState:this.respawnRecovery.state,
        terrain:this.terrain
      }) } : {}),
      serverPositionAgeMs: age,
      correctionCount: this.corrections,
      movementAuthority: this.movementAuthority,
      movementAuthoritySource: this.movementAuthoritySource,
      serverGameMode: this.playerGameMode === 'fallback' ? this.worldGameMode : this.playerGameMode,
      playerGameMode: this.playerGameMode,
      worldGameMode: this.worldGameMode,
      difficulty: this.difficulty,
      spawnHandshake: { ...this.spawnTrace, lastRespawnState: this.lastRespawnState },
      respawnRecovery: { ...this.respawnRecovery },
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
    if (this.gameplayAgent?.snapshot()?.active && ![
      'status','inspect','agent_stop','autonomy_stop','stop_movement','advisor_review','learning_stop','learning_autopilot_stop','odyssey_observe'
    ].includes(raw.action))
      return {status:'rejected',reason:'gameplay_agent_busy_stop_first'};
    // Layer 8 enforces a fresh authenticated world for *new* plans.
    // Stop, status and disabling suggestions remain possible when stale.
    if (this.layerEight && [
      'plan_follow', 'plan_return', 'plan_collect', 'inspect_block', 'plan_food',
      'plan_shelter', 'plan_craft_planks', 'plan_workflow', 'review_checkpoint', 'learning_start'
    ].includes(raw.action)) {
      const preflight = this.layerEight.allowPreview(this.readinessInput());
      if (!preflight.allowed)
        return { status: 'rejected', reason: preflight.reason };
    }
    if (raw.action === 'status') return { status: 'ok', reason: 'snapshot_available' };
    if (raw.action === 'odyssey_observe') {
      if (raw.confirmed !== true) return { status: 'rejected', reason: 'confirmation_required' };
      if (typeof raw.primitive !== 'string') return { status: 'rejected', reason: 'primitive_required' };
      return executeBedrockObservation(this, raw.primitive, raw.args ?? {});
    }
    if (raw.action === 'agent_stop') {
      const learning = gameplaySkillManifest(this).learning;
      if (learning?.activeTask) return { status: 'rejected', reason: 'learning_task_owned_use_learning_stop' };
      return this.gameplayAgent?.stop('user_stopped') ??
        {status:'rejected',reason:'gameplay_agent_unavailable'};
    }
    if (raw.action === 'agent_start') {
      // Reconcile a completed learning run against its own task before a new goal can replace its snapshot.
      const learning = gameplaySkillManifest(this).learning;
      if (learning?.activeTask) return { status: 'rejected', reason: 'learning_task_owned_stop_or_finish_first' };
      return this.gameplayAgent?.start(this,{
        confirmed:raw.confirmed,goal:raw.goal,playerName:raw.playerName
      })??{status:'rejected',reason:'gameplay_agent_unavailable'};
    }
    if (raw.action === 'learning_start') {
      return startLearningTask(this, raw.taskId, { confirmed: raw.confirmed });
    }
    if (raw.action === 'learning_stop') {
      return stopLearningTask(this, 'learning_user_stopped');
    }
    if (raw.action === 'learning_autopilot_start') {
      return startLocalAutopilot(this, { confirmed: raw.confirmed });
    }
    if (raw.action === 'learning_autopilot_stop') {
      return stopLocalAutopilot(this, 'user_disabled_autopilot');
    }
    if (raw.action === 'learning_propose') {
      if (raw.confirmed !== true) return { status: 'rejected', reason: 'confirmation_required' };
      return proposeLearningSkill(this, raw.skill);
    }
    if(raw.action === 'experimental_break') {
      if (raw.confirmed!==true)return {status:'rejected',reason:'confirmation_required'};
      if (this.autonomy?.snapshot()?.active)return {status:'rejected',reason:'autonomy_busy'};
      return this.blockBreaker?.start(this,raw.position,true)
        ?? {status:'rejected',reason:'block_break_unavailable'};
    }
    if(raw.action === 'autonomy_stop') {
      this.gameplayAgent?.stop('user_stopped');
      this.autonomy?.stop('user_stopped');
      return {status:'ok',reason:'autonomy_stopped'};
    }
    if(raw.action === 'follow_player') {
      // User-confirmed target selection plus existing bounded verified Follow.
      // Never bypass movement authority, terrain or survival safety gates.
      if(raw.confirmed!==true)return {status:'rejected',reason:'confirmation_required'};
      if(this.autonomy?.snapshot()?.active)
        return {status:'rejected',reason:'autonomy_already_active'};
      if(!this.spawned || !this.layerTwo || !this.autonomy)
        return {status:'rejected',reason:'follow_unavailable'};
      const plan=this.layerTwo.follow(raw.playerName,this.gameplayWorld());
      if(plan?.status!=='accepted')
        return plan??{status:'rejected',reason:'follow_plan_unavailable'};
      this.intelligence?.setGoal('follow');
      this.movement?.stop?.();
      this.layerOne?.stop('new_navigation_plan');
      this.layerThree?.cancel();
      this.layerFour?.setTask('follow');
      this.layerFive?.cancel();
      this.layerSix?.cancel();
      // Keep the selected plan visible if the path cannot be verified.
      return this.autonomy.enable(this,{confirmed:true});
    }
    if(raw.action === 'autonomy_follow') {
      if(!this.autonomy)return {status:'rejected',reason:'autonomy_runner_unavailable'};
      return this.autonomy.enable(this,{confirmed:raw.confirmed});
    }
    if(raw.action === 'verified_step') {
      if(raw.confirmed!==true)return {status:'rejected',reason:'confirmation_required'};
      if(this.autonomy?.snapshot().active)return {status:'rejected',reason:'autonomy_busy'};
      if(this.gameplayWorld().safetyHold)return {status:'rejected',reason:'survival_safety_override'};
      const route=this.autonomy?.route(this);
      if(route?.status!=='ready')
        return {status:'rejected',reason:route?.reason??'verified_path_unavailable'};
      return this.movement?.runVerifiedStep?.(this,route.waypoint,8)
        ?? {status:'rejected',reason:'movement_unavailable'};
    }
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
      this.gameplayAgent?.stop('user_stop');
      this.layerOne?.stop();
      this.layerTwo?.cancel();
      this.layerThree?.cancel();
      this.layerFour?.cancel();
      this.layerFive?.cancel();
      this.layerSix?.cancel();
      this.layerSeven?.setMode('off');
      this.addonNavigation?.emergencyStop();
      this.autonomy?.stop('user_stop');
      this.blockBreaker?.abort('user_stop');
      this.movement?.stop?.();
      return { status: 'ok', reason: 'movement_cancelled' };
    }
    if (raw.action === 'motion_diagnostic') {
      if (this.blockBreaker?.snapshot()?.active) return {status:'rejected',reason:'block_action_busy'};
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
      if (this.blockBreaker?.snapshot()?.active) return {status:'rejected',reason:'block_action_busy'};
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
    // This local deterministic tick advances the built-in curriculum without
    // any external model request. It remains inert until the user enables it.
    try { gameplaySkillManifest(this); } catch {}
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
      reason: result.reason,
      ...(command?.action === 'odyssey_observe' && result.status === 'ok' ? {
        primitive: result.primitive, result: result.result, observedAt: result.observedAt,
        verifiedBy: result.verifiedBy, readOnly: true, executed: false
      } : {})
    };
    this.lastReceipt = receipt;
    try { atomicJson(this.receiptPath, receipt); }
    catch { this.lastReceipt = { status: 'rejected', reason: 'receipt_write_failed' }; }
  }
  stop() {
    if (this.closed) return;
    this.closed = true;
    stopLocalAutopilot(this, 'session_closed');
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
    this.gameplayAgent?.stop('session_closed');
    this.autonomy?.stop('session_closed');
    this.blockBreaker?.abort('session_closed');
    this.movement?.stopPresence?.('session_closed');
    this.movement?.stop?.();
    this.layerOne?.stop('session_closed');
    this.layerTwo?.reset();
    this.layerThree?.reset();
    this.layerFour?.reset();
    this.layerFive?.reset();
    this.layerSix?.reset();
    this.layerSeven?.reset();
    this.addonNavigation?.reset();
    this.terrain?.reset();
    this.lifeSenses?.reset();
    this.intelligence?.reset();
    this.navigationRoute=null;
    this.playerNames.clear();
    for (const [event, callback] of this.listeners) this.client.removeListener(event, callback);
    this.listeners = [];
    this.players.clear();
    this.receivedChunks.clear();
  }
}

module.exports = { BedrockGameplayBridge, finitePosition, safePoint, validTick };
