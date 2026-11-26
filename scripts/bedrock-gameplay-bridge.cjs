'use strict';

/**
 * Live Bedrock gameplay session mirror and private, single-command IPC.
 * Uses the SAME client as the Xbox/NetherNet Android friend-world runner.
 * Source is original; no Minecraft addon implementation is embedded.
 */
const { readFileSync, writeFileSync, renameSync, unlinkSync, statSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { executeBedrockObservation } = require('./bedrock-odyssey-observation-executor.cjs');
const { normalizeBedrockBlockId, validateBedrockBlockPosition, isBedrockAirBlock, buildBedrockSetBlockCommand } = require('./bedrock-block-placement.cjs');
const { BedrockStackRequestManager } = require('./bedrock-stack-request-manager.cjs');
const { BedrockInventoryLedger } = require('./bedrock-inventory-ledger.cjs');
const { BedrockRecipeCatalog, sumItem } = require('./bedrock-recipe-catalog.cjs');
const { buildFirstPersonScene } = require('./bedrock-first-person-scene.cjs');
const { BedrockTerrainCheck } = require('./bedrock-terrain-check.cjs');
const { gameplaySkillManifest, tickLearningEngine, startLearningTask, stopLearningTask, startLocalAutopilot, stopLocalAutopilot, proposeLearningSkill, learningEngineFor, evaluateCapabilities, startBedrockNativeSkill } = require('./bedrock-skill-manifest.cjs');

const MAX_COMMAND_BYTES = 2048;
const MAX_VISIBLE_PLAYERS = 64;
const MAX_CHUNKS = 128;
const COMMAND_ACTIONS = new Set(['status', 'inspect', 'wait', 'stay', 'set_home', 'plan_follow', 'plan_return', 'plan_collect', 'inspect_block', 'plan_food', 'plan_shelter', 'plan_craft_planks', 'plan_workflow', 'review_checkpoint', 'advisor_mode', 'advisor_review', 'stop_movement', 'manual_move', 'manual_stop', 'autonomy_follow', 'follow_player', 'autonomy_stop', 'agent_start', 'agent_stop', 'verified_step', 'experimental_break', 'learning_start', 'native_skill_start', 'learning_stop', 'learning_propose', 'learning_autopilot_start', 'learning_autopilot_stop', 'odyssey_observe', 'odyssey_execute']);
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
    this.terrainCheck = options.terrainCheck ?? new BedrockTerrainCheck();
    this.routePlanner = options.routePlanner ?? null;
    this.registryResolver = options.registryResolver ?? null;
    this.navigationRoute = null;
    this.subchunkRequestKeys = new Map();
    this.subchunkPollingModes = new Map();
    this.subchunkRequestsSent = 0;
    this.subchunksRequested = 0;
    this.subchunkRequestErrors = 0;
    this.subchunkResponsePackets = 0;
    this.subchunkResponseEntries = 0;
    this.subchunkResponseSuccesses = 0;
    this.subchunkResponseAllAir = 0;
    this.subchunkResponseFailures = 0;
    this.subchunkLastResponse = null;
    this.blockNetworkIdsAreHashes = false;
    this.serverCustomBlockPropertiesCount = 0;
    this.autonomy = options.autonomy ?? null;
    this.blockBreaker = options.blockBreaker ?? null;
    if (typeof this.movement?.setBlockExecutor === 'function')
      this.movement.setBlockExecutor(this.blockBreaker);
    this.lifeSenses = options.lifeSenses ?? null;
    this.intelligence = options.intelligence ?? null;
    this.gameplayAgent = options.gameplayAgent ?? null;
    this.clock = options.clock ?? Date.now;
    this.setInterval = options.setInterval ?? setInterval;
    this.clearInterval = options.clearInterval ?? clearInterval;
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
    this.itemStackNetManager = null;
    this.commandsEnabled = false;
    this.permissionLevel = 'visitor';
    this.pendingBlockPlacement = null;
    this.lastBlockPlacement = null;
    this.inventoryLedger = options.inventoryLedger ?? new BedrockInventoryLedger({ clock: this.clock });
    this.stackRequests = new BedrockStackRequestManager(this.client, {
      isEnabled: () => this.itemStackNetManager === true, timeoutMs: 5000
    });
    this.recipeCatalog = options.recipeCatalog ?? new BedrockRecipeCatalog({ clock: this.clock });
    this.pendingCraft = null;
    this.lastCraft = null;
    this.selectedHotbarSlot = null;
    this.pendingHotbarSelection = null;
    this.lastHotbarSelection = null;
    this.spawnTrace = { respawnSeen: 0, respawnAcknowledged: 0,
      loadingCompleted: false, loadingPacketsSent: 0, handshakeErrors: 0 };
    this.lastRespawnState = null;
    this.respawnRecovery = { state: 'alive', deaths: 0, requests: 0,
      actionRequests: 0, recovered: 0, attempts: 0, lastActionAt: 0,
      firstRequestAt: 0, nextActionAt: 0, serverState: null,
      spawnObserved: false, healthConfirmed: false, position: null, resumeTask: null,
      resumeResult: null, error: null };
    this.watch = null;
    this.controlWatch = null;
    this.commandPollMs = Number.isFinite(options.commandPollMs) ? Math.max(10, Math.min(100, Math.round(options.commandPollMs))) : 25;
    this.controlTickMs = Number.isFinite(options.controlTickMs) ? Math.max(50, Math.min(250, Math.round(options.controlTickMs))) : 100;
    this.learningTickStatus = { state: 'not_started', reason: 'runtime_tick_not_started' };
    this.controlTickStatus = { state: 'not_started', reason: 'control_tick_not_started' };
    this.lastIntelligenceDecision = null;
    this.lastAddonNavigationSnapshot = null;
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
    this.bind('level_chunk', p => {
      this.chunk(p);
      this.terrain?.levelChunk(p);
      this.observeSubchunkPollingChunk(p);
    });
    this.bind('subchunk', p => {
      this.observeSubchunkResponse(p);
      this.terrain?.subChunk(p);
    });
    // Support the canonical packet spelling used by alternate SDK adapters.
    this.bind('sub_chunk', p => {
      this.observeSubchunkResponse(p);
      this.terrain?.subChunk(p);
    });
    this.bind('move_player', p => this.move(p));
    this.bind('correct_player_move_prediction', p => this.correction(p));
    this.bind('set_entity_motion', p => this.motion(p));
    this.bind('inventory_slot', p => {
      this.inventoryLedger?.observeSlot(p);
      this.layerThree?.observeInventorySlot(p);
    });
    this.bind('inventory_content', p => {
      this.inventoryLedger?.observeContent(p);
      this.layerOne?.onInventory(p);
      this.layerThree?.observeInventory(p);
      this.layerFour?.observeInventory(this.layerThree?.inventoryItems() ?? { known: false, observedAt: null, counts: {} });
      this.layerFive?.observeInventory(this.layerThree?.inventoryItems() ?? { known: false, observedAt: null, counts: {} });
      this.layerSix?.observeContainer(p);
      this.checkPendingCraft();
    });
    this.bind('item_registry', p => {
      this.inventoryLedger?.observeItemRegistry(p);
      this.recipeCatalog?.observeItemRegistry(p);
      this.layerThree?.observeItemRegistry(p);
      this.layerFour?.observeInventory(this.layerThree?.inventoryItems() ?? { known: false, observedAt: null, counts: {} });
      this.layerFive?.observeInventory(this.layerThree?.inventoryItems() ?? { known: false, observedAt: null, counts: {} });
    });
    this.bind('crafting_data', p => this.recipeCatalog?.observeCraftingData(p));
    this.bind('set_time', p => this.layerFour?.observeTime(p?.time));
    this.bind('command_output', p => this.onCommandOutput(p));
    this.bind('update_block', p => {
      this.blockBreaker?.observedBlock(p, this.dimension);
      this.terrain?.updateBlock(p, this.dimension);
      this.observeBlockPlacement(p);
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
    this.bind('player_hotbar', p => this.playerHotbar(p));
    this.bind('remove_actor', p => this.removeActor(p));
    this.bind('remove_entity', p => this.removeActor(p));
    this.bind('change_dimension', p => this.dimensionChange(p));
    this.bind('close', () => this.stop());
    if (this.commandPath && this.receiptPath) {
      // Keep file IPC responsive without forcing expensive world/intelligence
      // work at the same frequency. The gameplay safety loop remains separate.
      this.watch = this.setInterval(() => this.poll(), this.commandPollMs);
      this.controlWatch = this.setInterval(() => {
        if (this.closed) return;
        this.tickControlPlane();
        this.tickRespawnRecovery();
        this.tickLearning();
      }, this.controlTickMs);
      this.watch.unref?.();
      this.controlWatch.unref?.();
    }
    return this;
  }
  startGame(packet) {
    if (!packet || typeof packet !== 'object') return;
    stopLocalAutopilot(this, 'new_world_session');
    this.gameplayAgent?.stop('new_world_session');
    this.cancelPendingBlockPlacement('new_world_session');
    this.cancelPendingCraft('new_world_session');
    this.recipeCatalog?.reset();
    this.commandsEnabled = packet.enable_commands === true;
    this.permissionLevel = typeof packet.permission_level === 'string' ? packet.permission_level : 'visitor';
    this.self = ident(packet.runtime_entity_id ?? packet.entity_runtime_id);
    this.selfUnique = ident(packet.entity_id);
    this.position = safePoint(packet.player_position);
    const startRotation = packet.rotation;
    this.pitch = Number.isFinite(startRotation?.x) ? startRotation.x : null;
    this.yaw = Number.isFinite(startRotation?.z) ? startRotation.z :
      Number.isFinite(startRotation?.y) ? startRotation.y : null;
    this.lastServerPositionAt = this.position ? this.clock() : null;
    this.dimension = validDimension(packet.dimension);
    this.blockNetworkIdsAreHashes = packet.block_network_ids_are_hashes === true;
    this.serverCustomBlockPropertiesCount = Array.isArray(packet.block_properties)
      ? Math.min(1024, packet.block_properties.length) : 0;
    this.itemStackNetManager = typeof packet.enable_item_stack_net_manager === 'boolean'
      ? packet.enable_item_stack_net_manager : null;
    this.inventoryLedger?.reset();
    this.selectedHotbarSlot = null;
    this.pendingHotbarSelection = null;
    this.lastHotbarSelection = null;
    this.terrain?.reset(this.dimension);
    this.terrainCheck?.reset?.();
    this.intelligence?.reset(this.dimension);
    this.navigationRoute = null;
    this.lastIntelligenceDecision = null;
    this.lastAddonNavigationSnapshot = null;
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
      actionRequests: 0, recovered: 0, attempts: 0, lastActionAt: 0,
      firstRequestAt: 0, nextActionAt: 0, serverState: null,
      spawnObserved: false, healthConfirmed: false, position: null, resumeTask: null,
      resumeResult: null, error: null };
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
    this.subchunkRequestKeys.clear();
    this.subchunkPollingModes.clear();
    this.subchunkRequestsSent = 0;
    this.subchunksRequested = 0;
    this.subchunkRequestErrors = 0;
    this.subchunkResponsePackets = 0;
    this.subchunkResponseEntries = 0;
    this.subchunkResponseSuccesses = 0;
    this.subchunkResponseAllAir = 0;
    this.subchunkResponseFailures = 0;
    this.subchunkLastResponse = null;
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
  respawnRetryDelay(attempt) {
    const safeAttempt = Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
    return Math.min(1800 * (2 ** Math.min(safeAttempt - 1, 16)), 10000);
  }
  sendClientReadyToSpawn(position, now = this.clock()) {
    const recovery = this.respawnRecovery;
    if (!finitePosition(position)) {
      recovery.error = 'server_respawn_position_unavailable';
      recovery.lastActionAt = now;
      recovery.nextActionAt = now + this.respawnRetryDelay(recovery.requests + 1);
      return false;
    }
    recovery.requests++;
    recovery.lastActionAt = now;
    recovery.nextActionAt = now + this.respawnRetryDelay(recovery.requests);
    try {
      this.client.queue('respawn', {
        state: 2, position: safePoint(position), runtime_entity_id: BigInt(this.self)
      });
      recovery.state = 'client_ready_sent';
      recovery.error = null;
      this.spawnTrace.respawnAcknowledged++;
      return true;
    } catch {
      this.spawnTrace.handshakeErrors++;
      recovery.error = 'client_ready_write_failed';
      return false;
    }
  }
  sendRespawnAction(position) {
    const recovery = this.respawnRecovery;
    const now = this.clock();
    if (!finitePosition(position)) {
      recovery.error = 'server_respawn_position_unavailable';
      recovery.lastActionAt = now;
      recovery.nextActionAt = now + this.respawnRetryDelay(recovery.attempts + 1);
      return false;
    }
    // Retry indefinitely with capped exponential backoff; never flood a host.
    recovery.attempts++;
    recovery.lastActionAt = now;
    recovery.nextActionAt = now + this.respawnRetryDelay(recovery.attempts);
    try {
      const blockPos = {
        x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z)
      };
      this.client.queue('player_action', {
        runtime_entity_id: BigInt(this.self), action: 'respawn',
        position: blockPos, result_position: blockPos, face: 0
      });
      recovery.actionRequests++;
      recovery.state = 'respawn_action_sent';
      recovery.error = null;
      return true;
    } catch {
      this.spawnTrace.handshakeErrors++;
      recovery.error = 'respawn_action_write_failed';
      return false;
    }
  }
  tickRespawnRecovery() {
    const recovery = this.respawnRecovery;
    if (this.closed || recovery.state === 'alive') return false;
    const now = this.clock();
    if (!Number.isFinite(now) || now < recovery.firstRequestAt) return false;
    const position = recovery.position;
    if (!finitePosition(position)) return false;
    if (recovery.state === 'dead_waiting_for_server') {
      if (now < recovery.nextActionAt ||
          (recovery.serverState !== 0 && recovery.serverState !== 1)) return false;
      const sent = this.sendClientReadyToSpawn(position, now);
      if (sent && recovery.serverState === 1) return this.sendRespawnAction(position) || sent;
      return sent;
    }
    if (recovery.state === 'client_ready_sent') {
      if (recovery.serverState === 1 &&
          (recovery.attempts === 0 || now >= recovery.nextActionAt))
        return this.sendRespawnAction(position);
      if (now < recovery.nextActionAt) return false;
      if (recovery.serverState === 0) return this.sendClientReadyToSpawn(position, now);
      return false;
    }
    if (recovery.state === 'respawn_action_sent' && now >= recovery.nextActionAt)
      return this.sendRespawnAction(position);
    return false;
  }
  restoreRespawnTask(task) {
    const recovery = this.respawnRecovery;
    if (!task) return false;
    let planned;
    if (task.goal === 'follow' && typeof task.playerName === 'string' && task.playerName) {
      planned = this.layerTwo?.follow?.(task.playerName, this.gameplayWorld());
    } else if (task.goal === 'return') {
      planned = this.layerTwo?.returnHome?.(this.gameplayWorld());
    } else {
      recovery.resumeResult = 'unsupported_resume_goal';
      return false;
    }
    if (planned?.status !== 'accepted') {
      recovery.resumeResult = planned?.reason ?? 'resume_target_not_valid';
      return false;
    }
    if (task.autonomous === true) {
      const resumed = this.autonomy?.enable?.(this, { confirmed: true });
      recovery.resumeResult = resumed?.status === 'accepted'
        ? 'autonomous_task_resumed' : (resumed?.reason ?? 'resume_movement_not_ready');
      return resumed?.status === 'accepted';
    }
    recovery.resumeResult = 'navigation_plan_restored';
    return true;
  }
  completeRespawnRecovery() {
    const recovery = this.respawnRecovery;
    if (this.closed || recovery.state === 'alive' || !recovery.healthConfirmed ||
        !finitePosition(recovery.position) || !recovery.spawnObserved) return false;
    const position = safePoint(recovery.position);
    const resumeTask = recovery.resumeTask;
    this.position = position;
    this.lastServerPositionAt = this.clock();
    this.layerOne?.onServerPosition(this.position);
    recovery.recovered++;
    recovery.state = 'alive';
    recovery.attempts = 0;
    recovery.requests = 0;
    recovery.lastActionAt = 0;
    recovery.firstRequestAt = 0;
    recovery.nextActionAt = 0;
    recovery.serverState = null;
    recovery.spawnObserved = false;
    recovery.healthConfirmed = false;
    recovery.position = null;
    recovery.resumeTask = null;
    recovery.error = null;
    this.spawned = true;
    this.movement?.startPresence?.(this);
    this.restoreRespawnTask(resumeTask);
    return true;
  }
  observeHealth(health) {
    if (this.closed || !Number.isFinite(health) || !this.self) return;
    if (health <= 0) {
      this.cancelPendingBlockPlacement('player_died');
      if (!this.spawned || this.respawnRecovery.state !== 'alive') return;
      const follow = this.layerTwo?.preview?.(this.gameplayWorld());
      const autonomous = this.autonomy?.snapshot?.()?.active === true;
      const resumeTask = follow && ['follow', 'return'].includes(follow.goal)
        ? { goal: follow.goal, playerName: follow.targetName ?? null, autonomous }
        : null;
      const now = this.clock();
      this.respawnRecovery.state = 'dead_waiting_for_server';
      this.respawnRecovery.deaths++;
      this.respawnRecovery.attempts = 0;
      this.respawnRecovery.requests = 0;
      this.respawnRecovery.lastActionAt = 0;
      this.respawnRecovery.firstRequestAt = now + 4000;
      this.respawnRecovery.nextActionAt = this.respawnRecovery.firstRequestAt;
      this.respawnRecovery.serverState = null;
      this.respawnRecovery.spawnObserved = false;
      this.respawnRecovery.healthConfirmed = false;
      this.respawnRecovery.position = null;
      this.respawnRecovery.resumeTask = resumeTask;
      this.respawnRecovery.resumeResult = null;
      this.respawnRecovery.error = null;
      this.lastRespawnState = null;
      this.gameplayAgent?.stop('player_died');
      this.spawned = false;
      this.autonomy?.stop('player_died');
      this.blockBreaker?.abort('player_died');
      this.movement?.stopPresence?.('player_died');
      this.movement?.stop?.('player_died', { silent: true });
      this.layerTwo?.cancel?.();
      this.addonNavigation?.emergencyStop?.();
      return;
    }
    if (this.respawnRecovery.state !== 'alive') {
      // Health and Respawn packets may arrive in either order. Health alone
      // cannot release movement; wait for this death's server spawn position.
      this.respawnRecovery.healthConfirmed = true;
      this.completeRespawnRecovery();
    }
  }
  onRespawn(packet) {
    if (this.closed || !packet || !Number.isInteger(packet.state)) return;
    const incomingId = ident(packet.runtime_entity_id);
    if (incomingId && incomingId !== '0') this.self = incomingId;
    this.spawnTrace.respawnSeen++;
    this.lastRespawnState = packet.state;
    if (!this.self || typeof this.client.queue !== 'function') return;
    const recovery = this.respawnRecovery;
    const position = finitePosition(packet.position) ? safePoint(packet.position) : null;
    if (recovery.state !== 'alive') {
      if (packet.state !== 0 && packet.state !== 1) return;
      recovery.serverState = packet.state;
      if (position) {
        recovery.position = position;
        if (packet.state === 1) {
          recovery.spawnObserved = true;
          this.position = { ...position };
          this.lastServerPositionAt = this.clock();
          this.layerOne?.onServerPosition(this.position);
        }
      } else {
        recovery.error = 'server_respawn_position_unavailable';
      }
      if (packet.state === 0 && recovery.state !== 'dead_waiting_for_server') {
        // The host returned to SearchingForSpawn. Re-enter the ready phase
        // instead of resending PlayerAction(respawn) forever. Reset the
        // action-cycle counter so the next ReadyToSpawn can be acknowledged.
        recovery.state = 'dead_waiting_for_server';
        recovery.attempts = 0;
        recovery.spawnObserved = false;
      }
      if (this.completeRespawnRecovery()) return;
      this.tickRespawnRecovery();
      return;
    }
    // Normal first join / non-death handshake remains unchanged.
    if (packet.state !== 1 || !position) return;
    try {
      this.client.queue('respawn', {
        state: 2, position, runtime_entity_id: BigInt(this.self)
      });
      this.spawnTrace.respawnAcknowledged++;
      this.position = { ...position };
      this.lastServerPositionAt = this.clock();
      this.layerOne?.onServerPosition(this.position);
    } catch { this.spawnTrace.handshakeErrors++; }
  }
  onSpawn() {
    if (this.closed) return;
    if (this.respawnRecovery.state !== 'alive') {
      this.respawnRecovery.spawnObserved = true;
      this.completeRespawnRecovery();
      return;
    }
    this.spawned = true;
    if (this.spawnTrace.loadingCompleted || typeof this.client.queue !== 'function') {
      // The health+Respawn recovery path may already have re-anchored the
      // movement stream before the SDK emits its companion spawn event.
      if (this.spawnTrace.loadingCompleted &&
          this.movement?.snapshot?.()?.presenceActive !== true)
        this.movement?.startPresence?.(this);
      return;
    }
    try {
      this.client.queue('serverbound_loading_screen', { type: 1 });
      this.spawnTrace.loadingPacketsSent++;
      this.client.queue('serverbound_loading_screen', { type: 2 });
      this.spawnTrace.loadingPacketsSent++;
      this.spawnTrace.loadingCompleted = true;
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
  positionStatus() {
    const age = this.lastServerPositionAt == null
      ? null : this.clock() - this.lastServerPositionAt;
    const motion = this.movement?.snapshot?.() ?? {};
    const sessionReady = !this.closed && this.spawned && this.self != null &&
      this.position != null && Number.isInteger(this.dimension) &&
      [1, 2].includes(this.movementAuthority) &&
      typeof this.serverTick === 'bigint' && this.receivedChunks.size > 0;
    if (!sessionReady || age == null || !Number.isFinite(age) || age < 0)
      return { usable: false, mode: 'position_unknown', ageMs: age };
    if (motion.unconfirmedMovement === true)
      return { usable: false, mode: 'awaiting_server_position', ageMs: age };
    if (age <= 7000)
      return { usable: true, mode: 'server_fresh', ageMs: age };
    // Bedrock may stay silent when the client is stationary. Keep the spawn
    // anchor only while the input stream is neutral; after movement, require
    // a fresh server correction before autonomy can trust the new position.
    if (motion.presenceActive === true && motion.nonNeutralFrames === 0 &&
        Number.isInteger(motion.presenceFrames) && motion.presenceFrames > 0)
      return { usable: true, mode: 'idle_spawn_anchor', ageMs: age };
    return { usable: false, mode: 'server_position_stale', ageMs: age };
  }
  positionUsable() { return this.positionStatus().usable; }
  isIdlePositionAnchor() { return this.positionStatus().mode === 'idle_spawn_anchor'; }
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
      positionUsable: this.positionUsable(),
      idlePositionAnchor: this.isIdlePositionAnchor(),
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
    // Bedrock may send AddPlayer before PlayerList. Reconcile both packet
    // orders so an initially unnamed actor gains its gamertag when available.
    const payload = packet.records ?? packet.entries;
    const entries = Array.isArray(payload) ? payload :
      payload && typeof payload === 'object'
        ? (Array.isArray(payload.records) ? payload.records : payload.entries)
        : null;
    if (!Array.isArray(entries)) return;
    const action = packet.action_type ?? packet.action ?? payload?.type ?? payload?.action;
    const removal = action === 'remove' || action === 1;
    for (const p of entries.slice(0, MAX_VISIBLE_PLAYERS)) {
      const uuid = typeof p.uuid === 'string' ? p.uuid : null;
      if (!uuid || uuid.length > 64) continue;
      if (removal) {
        this.playerNames.delete(uuid);
        for (const [id, player] of this.players) {
          if (player.uuid !== uuid) continue;
          this.players.delete(id);
          this.layerTwo?.removePlayer(id);
        }
        continue;
      }
      const name = p.username;
      if (typeof name !== 'string' || !/^[a-zA-Z0-9_ #.-]{1,32}$/.test(name)) continue;
      if (this.playerNames.size >= MAX_VISIBLE_PLAYERS && !this.playerNames.has(uuid)) continue;
      this.playerNames.set(uuid, name);
      for (const [id, player] of this.players) {
        if (player.uuid !== uuid) continue;
        player.username = name;
        this.layerTwo?.observePlayer(id, name, player.position, this.dimension);
      }
    }
  }
  playerHotbar(packet) {
    if (this.closed || (packet?.window_id !== 0 && packet?.window_id !== 'inventory') ||
        packet?.select_slot !== true || !Number.isInteger(packet?.selected_slot) ||
        packet.selected_slot < 0 || packet.selected_slot > 8) return;
    this.selectedHotbarSlot = packet.selected_slot;
    if (this.pendingHotbarSelection?.slot === packet.selected_slot)
      this.pendingHotbarSelection.playerHotbarAckAt = this.clock();
  }
  equipment(packet) {
    if (this.closed || ident(packet?.runtime_entity_id ?? packet?.runtime_id) !== this.self) return;
    const selected = packet?.selected_slot;
    const itemId = packet?.item?.network_id ?? packet?.item?.id ?? null;
    this.layerTwo?.observeEquipment(selected ?? packet?.slot, itemId);
    if (!Number.isInteger(selected) || selected < 0 || selected > 8) return;
    this.selectedHotbarSlot = selected;
    const verified = this.lastHotbarSelection;
    if (verified?.status === 'verified' &&
        (verified.slot !== selected || (itemId != null && Number(itemId) !== verified.networkId))) {
      this.lastHotbarSelection = { ...verified, status: 'invalidated',
        reason: 'server_equipment_changed' };
    }
    const pending = this.pendingHotbarSelection;
    if (pending && pending.slot === selected && Number(itemId) === pending.networkId) {
      this.lastHotbarSelection = { ...pending, status: 'verified',
        verifiedAt: this.clock(), reason: 'server_mob_equipment_confirmed' };
      this.pendingHotbarSelection = null;
    }
  }
  hotbarSelectionSnapshot() {
    const pending = this.pendingHotbarSelection;
    if (pending && this.clock() - pending.requestedAt > 5000) {
      this.lastHotbarSelection = { ...pending, status: 'timed_out',
        reason: 'server_equipment_confirmation_timeout' };
      this.pendingHotbarSelection = null;
    }
    return {
      selectedSlot: this.selectedHotbarSlot,
      pending: this.pendingHotbarSelection ? { ...this.pendingHotbarSelection } : null,
      last: this.lastHotbarSelection ? { ...this.lastHotbarSelection } : null
    };
  }
  selectHotbarTool(primitive) {
    this.hotbarSelectionSnapshot();
    const suffix = ({ equipAxe: '_axe', equipHoe: '_hoe',
      equipPickaxe: '_pickaxe', equipSword: '_sword' })[primitive];
    if (!suffix) return { status: 'rejected', reason: 'unsupported_hotbar_tool' };
    const inventory = this.layerThree?.hotbarItems?.();
    if (!inventory?.known || !Number.isFinite(inventory.observedAt) ||
        this.clock() - inventory.observedAt < 0 || this.clock() - inventory.observedAt > 10000)
      return { status: 'rejected', reason: 'fresh_hotbar_inventory_required' };
    if (this.pendingHotbarSelection && this.clock() - this.pendingHotbarSelection.requestedAt <= 5000)
      return { status: 'rejected', reason: 'hotbar_selection_pending' };
    const candidate = inventory.slots.find(item => item.itemName.endsWith(suffix));
    if (!candidate) return { status: 'rejected', reason: 'matching_tool_not_in_hotbar' };
    if (this.selectedHotbarSlot === candidate.slot &&
        this.lastHotbarSelection?.status === 'verified' &&
        this.lastHotbarSelection?.itemName === candidate.itemName)
      return { status: 'ok', reason: 'requested_tool_already_server_selected',
        primitive, itemName: candidate.itemName, selectedSlot: candidate.slot,
        awaitingServerConfirmation: false };
    if (typeof this.client.queue !== 'function')
      return { status: 'rejected', reason: 'bedrock_packet_queue_unavailable' };
    const pending = { primitive, itemName: candidate.itemName, networkId: candidate.networkId,
      slot: candidate.slot, requestedAt: this.clock(), playerHotbarAckAt: null,
      status: 'awaiting_server_confirmation' };
    this.lastHotbarSelection = null;
    this.pendingHotbarSelection = pending;
    try {
      this.client.queue('player_hotbar', {
        selected_slot: candidate.slot, window_id: 0, select_slot: true
      });
    } catch {
      this.pendingHotbarSelection = null;
      return { status: 'rejected', reason: 'hotbar_selection_packet_failed' };
    }
    return { status: 'accepted', reason: 'hotbar_selection_sent_waiting_server_equipment',
      primitive, itemName: candidate.itemName, selectedSlot: candidate.slot,
      awaitingServerConfirmation: true };
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

  isSubchunkPollingChunk(packet) {
    if (!packet || typeof packet !== 'object') return false;
    const count = packet.sub_chunk_count;
    // 1.26.40+ uses negative SubChunkCount values for polling. Accept both
    // signed and unsigned representations used by protocol adapters.
    if (Number.isInteger(count) && count < 0) return true;
    if (Number.isInteger(count) && [0xfffffffe, 0xffffffff].includes(count >>> 0)) return true;
    // Protocol 1.26.60 exposes the optional request limit as
    // highest_subchunk_count (older adapters may use sub_chunk_limit).
    return Number.isInteger(packet.highest_subchunk_count) ||
      Number.isInteger(packet.sub_chunk_limit) ||
      Number.isInteger(packet.subchunk_request_limit);
  }

  subchunkPollingLimit(packet) {
    const raw = packet?.highest_subchunk_count ??
      packet?.sub_chunk_limit ?? packet?.subchunk_request_limit;
    if (!Number.isInteger(raw) || raw === -1) return null;
    if (raw < 0) return 0;
    return Math.min(48, raw);
  }

  observeSubchunkPollingChunk(packet) {
    if (!packet || !Number.isInteger(packet.x) || !Number.isInteger(packet.z)) return 0;
    const dimension = validDimension(packet.dimension);
    if (dimension == null || dimension !== this.dimension) return 0;
    const key = [dimension, packet.x, packet.z].join(':');
    if (!this.isSubchunkPollingChunk(packet)) {
      this.subchunkPollingModes.delete(key);
      return 0;
    }
    this.subchunkPollingModes.delete(key);
    this.subchunkPollingModes.set(key, {
      requestLimit: this.subchunkPollingLimit(packet),
      observedAt: this.clock()
    });
    while (this.subchunkPollingModes.size > MAX_CHUNKS)
      this.subchunkPollingModes.delete(this.subchunkPollingModes.keys().next().value);
    return this.requestLocalSubchunks(packet);
  }

  observeSubchunkResponse(packet) {
    if (!packet || typeof packet !== 'object') return;
    this.subchunkResponsePackets++;
    const center = packet.origin ?? packet.center;
    const entries = packet.entries ?? packet.sub_chunk_data;
    const dimension = validDimension(packet.dimension);
    if (!center || dimension == null || !Array.isArray(entries)) return;
    this.subchunkResponseEntries += entries.length;
    const now = this.clock();

    for (const entry of entries) {
      const offset = entry?.sub_chunk_pos_offset ?? entry?.subChunkPosOffset ??
        entry?.offset ?? entry;
      const dx = offset?.x ?? offset?.dx;
      const dy = offset?.y ?? offset?.dy;
      const dz = offset?.z ?? offset?.dz;
      if (![dx, dy, dz, center.x, center.y, center.z].every(Number.isInteger)) continue;
      const chunkX = center.x + dx;
      const sectionY = center.y + dy;
      const chunkZ = center.z + dz;
      const result = entry.result ?? entry.sub_chunk_request_result;
      const success = result === 'success' || result === 1;
      const allAir = result === 'success_all_air' || result === 6;
      if (success) this.subchunkResponseSuccesses++;
      else if (allAir) this.subchunkResponseAllAir++;
      else this.subchunkResponseFailures++;

      const key = [dimension, chunkX, sectionY, chunkZ].join(':');
      if (success || allAir) {
        this.subchunkRequestKeys.delete(key);
      } else {
        const previous = this.subchunkRequestKeys.get(key);
        if (previous) this.subchunkRequestKeys.set(key, { ...previous, lastAt: now });
      }
      this.subchunkLastResponse = {
        dimension, chunkX, sectionY, chunkZ,
        result: typeof result === 'string' || Number.isInteger(result) ? result : 'unknown',
        at: now
      };
    }
  }

  requestLocalSubchunks(packet) {
    if (this.closed || typeof this.client.queue !== 'function' || !packet ||
        !Number.isInteger(packet.x) || !Number.isInteger(packet.z)) return 0;
    const dimension = validDimension(packet.dimension);
    const position = this.position;
    if (dimension == null || dimension !== this.dimension || !finitePosition(position))
      return 0;

    const chunkKey = [dimension, packet.x, packet.z].join(':');
    const mode = this.subchunkPollingModes.get(chunkKey);
    const hasExactTargets = Array.isArray(packet.targetSections);
    if (!mode && !this.isSubchunkPollingChunk(packet) && !hasExactTargets) return 0;

    // SubChunkRequest offsets are relative to the player's absolute subchunk
    // position. X/Z in the center are chunk coordinates; Y is a section index.
    const center = {
      x: Math.floor(position.x / 16),
      y: Math.floor(position.y / 16),
      z: Math.floor(position.z / 16)
    };
    const dx = packet.x - center.x;
    const dz = packet.z - center.z;
    if (![center.x, center.y, center.z, dx, dz].every(Number.isInteger) ||
        Math.abs(center.x) > 1875000 || Math.abs(center.z) > 1875000 ||
        Math.abs(dx) > 127 || Math.abs(dz) > 127 ||
        center.y < -16 || center.y > 32) return 0;

    const sections = hasExactTargets
      ? [...new Set(packet.targetSections.filter(Number.isInteger))]
      : [-2, -1, 0, 1, 2].map(offset => center.y + offset);
    sections.sort((a, b) => Math.abs(a - center.y) - Math.abs(b - center.y) || a - b);

    const rawLimit = this.subchunkPollingLimit(packet);
    const limit = rawLimit ?? mode?.requestLimit ?? null;
    if (limit === 0) return 0;
    const maxRequests = limit == null ? sections.length : Math.min(sections.length, limit);
    const now = this.clock();
    const requests = [];
    const requestKeys = [];

    for (const sectionY of sections) {
      if (requests.length >= maxRequests) break;
      if (sectionY < -16 || sectionY > 32) continue;
      const offsetY = sectionY - center.y;
      if (!Number.isInteger(offsetY) || Math.abs(offsetY) > 127) continue;
      const key = [dimension, packet.x, sectionY, packet.z].join(':');
      const previous = this.subchunkRequestKeys.get(key);
      if (previous) {
        const retryDelay = Math.min(10000,
          500 * (2 ** Math.min(Math.max(0, previous.attempts - 1), 4)));
        const age = now - previous.lastAt;
        if (age < 0 || age < retryDelay) continue;
      }
      requests.push({ x: dx, y: offsetY, z: dz });
      requestKeys.push({ key, attempts: (previous?.attempts ?? 0) + 1 });
    }

    if (requests.length === 0) return 0;
    try {
      this.client.queue('subchunk_request', { dimension, requests, origin: center });
      for (const item of requestKeys)
        this.subchunkRequestKeys.set(item.key, { lastAt: now, attempts: item.attempts });
      while (this.subchunkRequestKeys.size > 512)
        this.subchunkRequestKeys.delete(this.subchunkRequestKeys.keys().next().value);
      this.subchunkRequestsSent++;
      this.subchunksRequested += requests.length;
      return requests.length;
    } catch {
      this.subchunkRequestErrors++;
      return 0;
    }
  }
  move(packet) {
    if (this.closed || !packet) return;
    const id = ident(packet.runtime_entity_id ?? packet.runtime_id);
    if (!id) return;
    const pos = safePoint(packet.position);
    if (!pos) return;
    if (id === this.self) {
      const rawMode = packet.mode;
      const modeName = typeof rawMode === 'string'
        ? rawMode.toLowerCase().replace(/[^a-z]/g, '') : '';
      const rotationOnly = rawMode === 3 ||
        ['rotation', 'onlyheadrot', 'onlyheadrotation'].includes(modeName);
      if (Number.isFinite(packet.yaw)) this.yaw = packet.yaw;
      if (Number.isFinite(packet.pitch)) this.pitch = packet.pitch;
      // OnlyHeadRot carries a position field for schema compatibility. It
      // must never move the world anchor or clear pending movement prediction.
      if (rotationOnly) {
        this.movement?.observeRotation?.(this.yaw, this.pitch);
        return;
      }
      this.position = pos;
      this.lastServerPositionAt = this.clock();
      this.layerOne?.onServerPosition(pos);
      const normalPosition = rawMode === 0 || modeName === 'normal';
      if (normalPosition) {
        this.movement?.observeServerPosition?.(pos, this.clock());
      } else {
        // Reset and Teleport are authoritative re-anchors, not positive
        // acknowledgements of the preceding joystick input.
        this.movement?.teleport?.(pos, packet);
      }
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
    this.movement?.observeRotation?.(this.yaw, this.pitch);
    this.movement?.correct?.(pos, tick, packet);
  }
  motion(packet) {
    if (this.closed || !packet || this.self == null ||
        ident(packet.runtime_entity_id) !== this.self) return;
    this.movement?.knockback?.(packet);
  }
  addPlayer(packet) {
    if (!packet || this.closed) return;
    const id = ident(packet.runtime_entity_id ?? packet.runtime_id);
    if (!id || id === this.self) return;
    if (this.players.size >= MAX_VISIBLE_PLAYERS && !this.players.has(id)) return;
    const position = safePoint(packet.position);
    if (!position) return;
    const uuid = typeof packet.uuid === 'string' ? packet.uuid : null;
    const name = typeof packet.username === 'string' ? packet.username : this.playerNames.get(uuid);
    this.players.set(id, { position, seenAt: this.clock(), uuid, username: name ?? null });
    this.lifeSenses?.observePlayer(id,position);
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
    this.cancelPendingBlockPlacement('dimension_changed');
    this.cancelPendingCraft('dimension_changed');
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
    this.respawnRecovery.state = 'alive';
    this.respawnRecovery.attempts = 0;
    this.respawnRecovery.lastActionAt = 0;
    this.respawnRecovery.position = null;
    this.respawnRecovery.error = null;
    this.spawnTrace = { respawnSeen: 0, respawnAcknowledged: 0,
      loadingCompleted: false, loadingPacketsSent: 0, handshakeErrors: 0 };
    this.receivedChunks.clear();
    this.subchunkRequestKeys.clear();
    this.subchunkPollingModes.clear();
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
    this.lastAddonNavigationSnapshot = this.addonNavigation.update({
      position: this.position,
      dimension: this.dimension,
      observedAt: this.lastServerPositionAt ?? -1,
      collisionVerified: route?.status==='route_found',
      safetyHold: this.layerFour?.critical === true ||
        this.layerOne?.snapshot()?.safetyHold === true
    });
    return this.lastAddonNavigationSnapshot;
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
      positionUsable:this.positionUsable(),
      idlePositionAnchor:this.isIdlePositionAnchor(),
      terrainReady:(this.terrain?.snapshot()?.decodedSections??0)>0,
      safetyHold:this.gameplayWorld().safetyHold
    });
    if(this.intelligence.shouldEmergencyStop()){
      // A threat or critical health immediately stops *ongoing* unsafe movement;
      // no autonomous retreat/combat is attempted without verified terrain.
      if(this.autonomy?.snapshot?.()?.active) this.autonomy.stop('intelligence_safety_stop');
      this.movement?.stop?.('intelligence_safety_stop',{silent:true});
    }
    this.lastIntelligenceDecision = result;
    return result;
  }
  tickControlPlane() {
    if (this.closed) return;
    try {
      // The gameplay agent owns its own cadence while active; otherwise keep
      // safety observations fresh from the bridge's 100 ms control loop.
      this.checkTerrainReadiness();
      if (!this.gameplayAgent?.snapshot?.()?.active) this.intelligenceTick();
      if (this.addonNavigation) this.updateAddonNavigation();
      this.controlTickStatus = { state: 'healthy', reason: 'control_tick_ok' };
    } catch {
      this.controlTickStatus = { state: 'error', reason: 'control_tick_failed' };
    }
  }
  checkTerrainReadiness() {
    if (this.closed || !this.terrainCheck) return null;
    const movementCapability = this.movement?.capability?.(this) ?? 'unavailable';
    const movementSnapshot = this.movement?.snapshot?.() ?? null;
    return this.terrainCheck.check({
      now: this.clock(), spawned: this.spawned, position: this.position,
      dimension: this.dimension, movementCapability, movementSnapshot,
      terrainSnapshot: this.terrain?.snapshot?.() ?? null,
      requestSubchunks: packet => this.requestLocalSubchunks(packet)
    });
  }

  requestMovementTerrainRecovery() {
    if (this.closed || !this.terrainCheck) return 0;
    const result = this.checkTerrainReadiness();
    return result?.columnsRequested ?? 0;
  }

  snapshot() {
    const now = this.clock();
    const age = this.lastServerPositionAt == null ? null : Math.max(0, now - this.lastServerPositionAt);
    const movementCapability = this.movement?.capability?.(this) ?? 'unavailable';
    const movementSystem = this.movement?.snapshot?.() ?? null;
    const terrainCheck = this.checkTerrainReadiness();
    return {
      state: this.closed ? 'closed' : this.spawned && this.self && this.position && this.receivedChunks.size
        ? 'observing' : 'awaiting_world',
      position: this.position ? { ...this.position } : null,
      dimension: this.dimension,
      visiblePlayers: this.players.size,
      loadedChunkHeaders: this.receivedChunks.size,
      subchunkRequestsSent: this.subchunkRequestsSent,
      subchunksRequested: this.subchunksRequested,
      subchunkRequestErrors: this.subchunkRequestErrors,
      subchunkPollingChunks: this.subchunkPollingModes.size,
      pendingSubchunkRequests: this.subchunkRequestKeys.size,
      subchunkResponsePackets: this.subchunkResponsePackets,
      subchunkResponseEntries: this.subchunkResponseEntries,
      subchunkResponseSuccesses: this.subchunkResponseSuccesses,
      subchunkResponseAllAir: this.subchunkResponseAllAir,
      subchunkResponseFailures: this.subchunkResponseFailures,
      subchunkLastResponse: this.subchunkLastResponse ? { ...this.subchunkLastResponse } : null,
      blockNetworkIdsAreHashes: this.blockNetworkIdsAreHashes,
      serverCustomBlockPropertiesCount: this.serverCustomBlockPropertiesCount,
      commandPermission: { enabled: this.commandsEnabled, level: this.permissionLevel },
      blockPlacement: this.pendingBlockPlacement ? {
        state: 'awaiting_server_confirmation', position: { ...this.pendingBlockPlacement.position },
        blockId: this.pendingBlockPlacement.blockId,
        serverAcknowledged: this.pendingBlockPlacement.acknowledged,
        serverObserved: this.pendingBlockPlacement.observed
      } : this.lastBlockPlacement ? { ...this.lastBlockPlacement,
        position: { ...this.lastBlockPlacement.position } } : { state: 'idle' },
      // A chunk header does NOT prove decoded, navigable block/voxel data.
      blocksDecoded: (this.terrain?.snapshot().decodedSections ?? 0)>0,
      ...(this.terrain ? { terrain: this.terrain.snapshot() } : {}),
      ...(terrainCheck ? { terrainCheck } : {}),
      craftingRecipes: this.recipeCatalog?.snapshot?.(64) ?? null,
      crafting: this.pendingCraft ? { state: 'awaiting_server_confirmation', recipeId: this.pendingCraft.recipe.id,
        resultItem: this.pendingCraft.resultItem, timesCrafted: this.pendingCraft.timesCrafted } : this.lastCraft ? { ...this.lastCraft } : { state: 'idle' },
      ...(this.navigationRoute ? { navigationRoute: this.navigationRoute } : {}),
      ...(this.autonomy ? { autonomy: this.autonomy.snapshot() } : {}),
      ...(this.gameplayAgent ? { gameplayAgent: this.gameplayAgent.snapshot() } : {}),
      ...(this.blockBreaker ? { blockBreak: this.blockBreaker.snapshot() } : {}),
      firstPerson: buildFirstPersonScene(this),
      controlRuntime: { ...this.controlTickStatus },
      learningRuntime: { ...this.learningTickStatus },
      gameplaySkills: gameplaySkillManifest(this),
      ...(this.intelligence ? { intelligence: this.lastIntelligenceDecision ?? this.intelligence.snapshot() } : {}),
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
      itemStackNetManager: this.itemStackNetManager,
      stackRequests: this.stackRequests.snapshot(),
      inventory: this.inventoryLedger?.snapshot() ?? { version: 'minepilot.bedrock-inventory.v1',
        revision: 0, generation: 0, windows: [], player: { known: false, fresh: false,
          reason: 'inventory_ledger_unavailable', observedAt: null, slotCount: 0, occupied: 0, items: [] } },
      hotbarSelection: this.hotbarSelectionSnapshot(),
      inventoryTransactionMode: this.itemStackNetManager === true ? 'server_authoritative'
        : this.itemStackNetManager === false ? 'legacy' : 'unknown',
      spawnHandshake: { ...this.spawnTrace, lastRespawnState: this.lastRespawnState },
      respawnRecovery: { ...this.respawnRecovery,
        resumeTask: this.respawnRecovery.resumeTask ? { ...this.respawnRecovery.resumeTask } : null },
      movement: movementCapability,
      ...(movementSystem ? { movementSystem } : {}),
      ...(this.layerOne ? { layerOne: this.layerOne.snapshot() } : {}),
      ...(this.layerTwo ? { layerTwo: this.layerTwo.snapshot(this.gameplayWorld()) } : {}),
      ...(this.layerThree ? { layerThree: this.layerThree.snapshot(this.gameplayWorld()) } : {}),
      ...(this.layerFour ? { layerFour: this.layerFour.snapshot() } : {}),
      ...(this.layerFive ? { layerFive: this.layerFive.snapshot(this.gameplayWorld()) } : {}),
      ...(this.layerSix ? { layerSix: this.layerSix.snapshot(this.gameplayWorld()) } : {}),
      ...(this.layerSeven ? { layerSeven: this.layerSeven.snapshot(this.advisorWorld()) } : {}),
      ...(this.layerEight ? { layerEight: this.layerEight.assess(this.readinessInput()) } : {}),
      ...(this.addonNavigation ? { addonNavigation: this.lastAddonNavigationSnapshot ?? this.addonNavigation.snapshot?.() ?? null } : {}),
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
      'status','inspect','agent_stop','autonomy_stop','stop_movement','manual_move','manual_stop','advisor_review','learning_stop','learning_autopilot_stop','odyssey_observe'
    ].includes(raw.action))
      return {status:'rejected',reason:'gameplay_agent_busy_stop_first'};
    // Layer 8 enforces a fresh authenticated world for *new* plans.
    // Stop, status and disabling suggestions remain possible when stale.
    if (this.layerEight && [
      'plan_follow', 'plan_return', 'plan_collect', 'inspect_block', 'plan_food',
      'plan_shelter', 'plan_craft_planks', 'plan_workflow', 'review_checkpoint', 'learning_start', 'native_skill_start'
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
    if (raw.action === 'odyssey_execute') {
      if (raw.confirmed !== true) return { status: 'rejected', reason: 'confirmation_required' };
      if (typeof raw.primitive !== 'string') return { status: 'rejected', reason: 'primitive_required' };
      const args = raw.args && typeof raw.args === 'object' && !Array.isArray(raw.args) ? raw.args : {};
      if (raw.primitive === 'craftRecipe') return this.startCraftRecipe(raw, args);
      if (raw.primitive === 'exploreUntil') {
        const result = this.gameplayAgent?.start(this, { confirmed: true, goal: 'explore' }) ??
          { status: 'rejected', reason: 'gameplay_agent_unavailable' };
        return result.status === 'accepted' ? { ...result, primitive: raw.primitive,
          awaitingServerConfirmation: true } : result;
      }
      if (raw.primitive === 'goto') {
        if (!finitePosition(args.targetPosition))
          return { status: 'rejected', reason: 'valid_target_position_required' };
        const result = this.gameplayAgent?.start(this, {
          confirmed: true, goal: 'goto', targetPosition: args.targetPosition
        }) ?? { status: 'rejected', reason: 'gameplay_agent_unavailable' };
        return result.status === 'accepted' ? { ...result, primitive: raw.primitive,
          awaitingServerConfirmation: true } : result;
      }
      if (['equipAxe','equipHoe','equipPickaxe','equipSword'].includes(raw.primitive))
        return this.selectHotbarTool(raw.primitive);
      if (raw.primitive === 'placeBlock')
        return this.startSingleBlockPlacement(raw, args);
      if (raw.primitive === 'mineBlock') {
        if (this.autonomy?.snapshot()?.active)
          return { status: 'rejected', reason: 'autonomy_busy' };
        const p = args.position;
        if (!p || !['x','y','z'].every(k => Number.isInteger(p[k])))
          return { status: 'rejected', reason: 'integer_block_position_required' };
        const result = this.blockBreaker?.start(this, p, true) ??
          { status: 'rejected', reason: 'block_break_unavailable' };
        return result.status === 'accepted' ? { ...result, primitive: raw.primitive,
          awaitingServerConfirmation: true } : result;
      }
      return { status: 'rejected', reason: 'primitive_executor_unavailable' };
    }
    if (raw.action === 'agent_stop') {
      const learning = gameplaySkillManifest(this).learning;
      if (learning?.activeTask) return { status: 'rejected', reason: 'learning_task_owned_use_learning_stop' };
      return this.gameplayAgent?.stop('user_stopped') ??
        {status:'rejected',reason:'gameplay_agent_unavailable'};
    }
    if (raw.action === 'agent_start') {
      // Reconcile a completed learning run before a new goal can replace its snapshot.
      // Direct command callers get the same explicit lifecycle tick as the IPC loop.
      this.tickLearning();
      const learning = gameplaySkillManifest(this).learning;
      if (learning?.activeTask) return { status: 'rejected', reason: 'learning_task_owned_stop_or_finish_first' };
      return this.gameplayAgent?.start(this,{
        confirmed:raw.confirmed,goal:raw.goal,playerName:raw.playerName
      })??{status:'rejected',reason:'gameplay_agent_unavailable'};
    }
    if (raw.action === 'learning_start') {
      return startLearningTask(this, raw.taskId, { confirmed: raw.confirmed });
    }
    if (raw.action === 'native_skill_start') {
      return startBedrockNativeSkill(this, evaluateCapabilities(this), learningEngineFor(this),
        raw.skillId, { confirmed: raw.confirmed });
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
      if (typeof this.movement?.releaseManual === 'function') this.movement.releaseManual();
      else this.movement?.stop?.();
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
      this.cancelPendingBlockPlacement('user_stop');
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
      if (typeof this.movement?.releaseManual === 'function') this.movement.releaseManual();
      else this.movement?.stop?.();
      return { status: 'ok', reason: 'movement_cancelled' };
    }
    if (raw.action === 'manual_stop') {
      if (typeof this.movement?.releaseManual === 'function') this.movement.releaseManual();
      else this.movement?.stop?.();
      return { status: 'ok', reason: 'manual_control_released' };
    }
    if (raw.action === 'manual_move') {
      if (raw.confirmed !== true)
        return { status: 'rejected', reason: 'confirmation_required' };
      if (!['vector','forward','backward','strafe_left','strafe_right','turn_left','turn_right','look_up','look_down','jump','sprint','sneak'].includes(raw.mode) ||
          !Number.isInteger(raw.ticks) || raw.ticks < 1 || raw.ticks > 8)
        return { status: 'rejected', reason: 'unsupported_manual_input' };
      if (raw.mode === 'vector' && (!Number.isFinite(raw.motionX) || !Number.isFinite(raw.motionY) ||
          Math.abs(raw.motionX) > 1 || Math.abs(raw.motionY) > 1))
        return { status: 'rejected', reason: 'invalid_analog_vector' };
      if (this.blockBreaker?.snapshot()?.active)
        return { status: 'rejected', reason: 'block_action_busy' };
      if (this.layerOne?.snapshot()?.safetyHold)
        return { status: 'rejected', reason: 'critical_health' };
      if (this.layerFour?.critical)
        return { status: 'rejected', reason: 'survival_hold' };
      if (this.gameplayAgent?.snapshot?.()?.active || this.autonomy?.snapshot?.()?.active)
        return { status: 'rejected', reason: 'autonomous_controller_busy' };
      if (!this.movement || typeof this.movement.runManualHold !== 'function')
        return { status: 'rejected', reason: 'movement_unavailable' };
      // Every refresh updates the physics controller. One server-tick stream
      // carries simulated state until release or the UI keepalive expires.
      return this.movement.runManualHold(this, {
        mode: raw.mode, ticks: raw.ticks,
        vector: Number.isFinite(raw.motionX) && Number.isFinite(raw.motionY) &&
          (raw.mode === 'vector' || Math.hypot(raw.motionX, raw.motionY) > 0)
          ? { x: raw.motionX, y: raw.motionY } : undefined,
        jump: raw.jump === true, sprint: raw.sprint === true, sneak: raw.sneak === true
      });
    }
    return { status: 'rejected', reason: 'unsupported_command' };
  }
  startSingleBlockPlacement(raw, args = {}) {
    if (raw?.confirmed !== true)
      return { status: 'rejected', reason: 'confirmation_required' };
    if (!this.spawned || !this.position || !this.positionUsable())
      return { status: 'rejected', reason: 'fresh_server_position_required' };
    if (this.commandsEnabled !== true || this.permissionLevel !== 'operator')
      return { status: 'rejected', reason: 'bedrock_operator_command_permission_required' };
    if (this.pendingBlockPlacement)
      return { status: 'rejected', reason: 'block_placement_busy' };
    if (!this.terrain || typeof this.terrain.blockName !== 'function')
      return { status: 'rejected', reason: 'decoded_block_terrain_required' };
    if (!this.selfUnique || typeof this.client.queue !== 'function')
      return { status: 'rejected', reason: 'command_request_identity_unavailable' };

    let position, blockId, command;
    try {
      position = validateBedrockBlockPosition(args.position, this.dimension);
      blockId = normalizeBedrockBlockId(args.blockId);
      command = buildBedrockSetBlockCommand(position, blockId, this.dimension);
    } catch (error) {
      return { status: 'rejected', reason: error?.message || 'invalid_block_placement' };
    }
    const current = this.terrain.blockName(this.dimension, position.x, position.y, position.z);
    if (typeof current !== 'string')
      return { status: 'rejected', reason: 'target_block_not_observed' };
    if (!isBedrockAirBlock(current))
      return { status: 'rejected', reason: 'target_must_be_observed_air' };
    const distance = Math.hypot(
      position.x + 0.5 - this.position.x,
      position.y + 0.5 - this.position.y,
      position.z + 0.5 - this.position.z
    );
    if (!Number.isFinite(distance) || distance > 6)
      return { status: 'rejected', reason: 'target_out_of_interaction_range' };

    const correlationId = randomUUID();
    const pending = {
      requestId: raw.requestId, correlationId, position, dimension: this.dimension,
      blockId, acknowledged: false, observed: false, startedAt: this.clock(), timer: null
    };
    pending.timer = setTimeout(() => {
      this.finishBlockPlacement('rejected', pending.acknowledged
        ? 'block_change_not_server_observed' : 'command_acknowledgement_timeout');
    }, 7000);
    pending.timer.unref?.();
    this.pendingBlockPlacement = pending;
    try {
      this.client.queue('command_request', {
        command,
        origin: {
          type: 'Player', uuid: randomUUID(), request_id: correlationId,
          player_entity_id: BigInt(this.selfUnique)
        },
        internal: false,
        version: 'Latest'
      });
    } catch {
      this.finishBlockPlacement('rejected', 'command_request_write_failed');
      return { status: 'rejected', reason: 'command_request_write_failed' };
    }
    return { status: 'accepted', reason: 'bedrock_command_dispatched',
      awaitingServerConfirmation: true, position, blockId };
  }
  onCommandOutput(packet) {
    const pending = this.pendingBlockPlacement;
    if (!pending || packet?.origin?.request_id !== pending.correlationId) return false;
    const successCount = Number.isInteger(packet.success_count) ? packet.success_count : 0;
    const explicitFailure = Array.isArray(packet.output) &&
      packet.output.some(output => output?.success === false);
    if (successCount < 1 || explicitFailure) {
      this.finishBlockPlacement('rejected', 'bedrock_command_rejected');
      return true;
    }
    pending.acknowledged = true;
    if (pending.observed) this.finishBlockPlacement('ok', 'block_placed_and_server_observed');
    return true;
  }
  observeBlockPlacement(packet) {
    const pending = this.pendingBlockPlacement, point = packet?.position;
    if (!pending || pending.dimension !== this.dimension || !point ||
        (packet.layer != null && packet.layer !== 0) ||
        point.x !== pending.position.x || point.y !== pending.position.y ||
        point.z !== pending.position.z) return false;
    const name = this.terrain?.blockName?.(this.dimension, point.x, point.y, point.z);
    if (name !== pending.blockId) return false;
    pending.observed = true;
    if (pending.acknowledged) this.finishBlockPlacement('ok', 'block_placed_and_server_observed');
    return true;
  }
  finishBlockPlacement(status, reason) {
    const pending = this.pendingBlockPlacement;
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingBlockPlacement = null;
    const detail = {
      requestId: pending.requestId, status, reason, position: { ...pending.position },
      blockId: pending.blockId, serverAcknowledged: pending.acknowledged,
      serverObserved: pending.observed, completedAt: this.clock()
    };
    this.lastBlockPlacement = detail;
    if (this.lastReceipt?.requestId === pending.requestId) {
      const receipt = { ...this.lastReceipt, status, reason, blockPlacement: detail };
      this.lastReceipt = receipt;
      if (this.receiptPath) {
        try { atomicJson(this.receiptPath, receipt); } catch {}
      }
    }
    return true;
  }
  cancelPendingBlockPlacement(reason = 'cancelled') {
    if (this.pendingBlockPlacement) return this.finishBlockPlacement('rejected', reason);
    return false;
  }

  startCraftRecipe(raw, args) {
    if (this.closed || !this.spawned) return { status: 'rejected', reason: 'bedrock_world_not_ready' };
    if (this.itemStackNetManager !== true)
      return { status: 'rejected', reason: 'server_authoritative_inventory_not_negotiated' };
    if (this.pendingCraft || this.stackRequests.snapshot().pending)
      return { status: 'rejected', reason: 'craft_transaction_busy' };
    const resultItem = typeof args.resultItem === 'string' ? args.resultItem.trim().toLowerCase() : '';
    const timesCrafted = args.timesCrafted ?? 1;
    const recipeId = typeof args.recipeId === 'string' ? args.recipeId : undefined;
    const inventory = this.inventoryLedger?.playerInventory?.({ maxAgeMs: 10000 });
    const plan = this.recipeCatalog?.resolve(resultItem, inventory, { recipeId, timesCrafted });
    if (plan?.status !== 'ready')
      return { status: plan?.status === 'blocked' ? 'blocked' : 'rejected',
        reason: plan?.reason ?? 'bedrock_recipe_catalog_unavailable',
        ...(Array.isArray(plan?.missing) ? { missing: plan.missing } : {}) };
    const pending = {
      requestId: raw.requestId, recipe: plan.recipe, resultItem,
      timesCrafted: plan.timesCrafted, outputExpected: plan.outputExpected,
      outputBefore: plan.outputBefore, ingredientBefore: plan.ingredientBefore,
      inventoryRevision: plan.inventoryRevision, inventoryGeneration: plan.inventoryGeneration,
      acknowledged: false, startedAt: this.clock(), timer: null
    };
    this.pendingCraft = pending;
    this.lastCraft = {
      status: 'awaiting_server_confirmation', reason: 'craft_recipe_request_sent',
      recipeId: pending.recipe.id, resultItem, timesCrafted: pending.timesCrafted,
      outputExpected: pending.outputExpected, serverAcknowledged: false, inventoryVerified: false
    };
    pending.timer = setTimeout(() => {
      if (this.pendingCraft === pending) this.finishCraft('rejected', 'craft_inventory_postcondition_timeout');
    }, 8000);
    pending.timer.unref?.();
    this.stackRequests.send([{
      type_id: 'craft_recipe',
      recipe_network_id: pending.recipe.networkId,
      times_crafted: pending.timesCrafted
    }], { timeoutMs: 5000 }).then(() => {
      if (this.pendingCraft !== pending) return;
      pending.acknowledged = true;
      this.lastCraft = { ...this.lastCraft, serverAcknowledged: true };
      this.checkPendingCraft();
    }).catch(error => {
      if (this.pendingCraft !== pending) return;
      const reason = error?.outcome === 'server_rejected' ? 'bedrock_craft_rejected_by_server'
        : error?.outcome === 'unsupported' ? 'server_authoritative_inventory_unavailable'
          : error?.outcome === 'timeout' ? 'bedrock_craft_response_timeout'
            : 'bedrock_craft_request_failed';
      this.finishCraft('rejected', reason);
    });
    return { status: 'accepted', reason: 'bedrock_craft_recipe_request_queued',
      primitive: 'craftRecipe', recipeId: pending.recipe.id, resultItem,
      timesCrafted: pending.timesCrafted, awaitingServerConfirmation: true };
  }

  checkPendingCraft() {
    const pending = this.pendingCraft;
    if (!pending) return false;
    const inventory = this.inventoryLedger?.playerInventory?.({ maxAgeMs: 10000 });
    if (!inventory || inventory.known !== true || inventory.fresh !== true ||
        inventory.fullSnapshotFresh !== true || inventory.generation !== pending.inventoryGeneration ||
        !Number.isInteger(inventory.revision) || inventory.revision <= pending.inventoryRevision ||
        !Number.isFinite(inventory.observedAt) || inventory.observedAt <= pending.startedAt) return false;
    const outputAfter = sumItem(inventory, pending.resultItem);
    const outputVerified = outputAfter >= pending.outputBefore + pending.outputExpected;
    const ingredientsVerified = pending.recipe.ingredients.every(item =>
      sumItem(inventory, item.name) <= (pending.ingredientBefore[item.name] ?? 0) -
        item.count * pending.timesCrafted);
    if (!outputVerified || !ingredientsVerified) return false;
    pending.inventoryVerified = true;
    if (pending.acknowledged) {
      this.finishCraft('ok', 'craft_response_and_inventory_verified', inventory);
      return true;
    }
    return false;
  }

  finishCraft(status, reason, inventory = null) {
    const pending = this.pendingCraft;
    if (!pending) return false;
    this.pendingCraft = null;
    if (pending.timer) clearTimeout(pending.timer);
    const detail = {
      status, reason, recipeId: pending.recipe.id, resultItem: pending.resultItem,
      timesCrafted: pending.timesCrafted, outputExpected: pending.outputExpected,
      serverAcknowledged: pending.acknowledged === true,
      inventoryVerified: status === 'ok',
      inventoryRevision: inventory?.revision ?? null,
      completedAt: this.clock()
    };
    this.lastCraft = detail;
    if (this.lastReceipt?.requestId === pending.requestId) {
      const receipt = { ...this.lastReceipt, status, reason, crafting: detail,
        awaitingServerConfirmation: false };
      this.lastReceipt = receipt;
      if (this.receiptPath) {
        try { atomicJson(this.receiptPath, receipt); } catch {}
      }
    }
    return true;
  }

  cancelPendingCraft(reason = 'cancelled') {
    return this.finishCraft('rejected', reason);
  }

  tickLearning() {
    // One explicit owner advances the curriculum. Reads of snapshots/manifests
    // never mutate task state. Keep failures visible without crashing the SDK loop.
    try {
      tickLearningEngine(this);
      this.learningTickStatus = { state: 'healthy', reason: 'runtime_tick_ok' };
    } catch {
      this.learningTickStatus = { state: 'error', reason: 'learning_tick_failed' };
    }
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
    // agent_start performs its own tick before replacing the current task.
    // All other commands share the normal single 100 ms runtime tick.
    const result = this.execute(command);
    const completedPlacement = command?.action === 'odyssey_execute' && command?.primitive === 'placeBlock' &&
      this.lastBlockPlacement?.requestId === command?.requestId ? this.lastBlockPlacement : null;
    const receipt = {
      version: 'minepilot.gameplay.v1',
      requestId: typeof command?.requestId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(command.requestId)
        ? command.requestId : '',
      status: completedPlacement?.status ?? result.status,
      reason: completedPlacement?.reason ?? result.reason,
      dispatchAccepted: result.status === 'accepted' || result.status === 'ok',
      executionStage: result.status === 'rejected' ? 'rejected'
        : command?.action === 'manual_move' ? 'movement_controls_applied'
        : result.status === 'accepted' ? 'dispatched' : 'completed',
      ...(command?.action === 'manual_move' ? {
        serverConfirmation: 'correction_only_if_prediction_differs'
      } : {}),
      ...(completedPlacement ? { blockPlacement: completedPlacement } : {}),
      ...(command?.action === 'odyssey_execute' ? {
        primitive: command.primitive,
        dispatchAccepted: result.status === 'accepted' || result.status === 'ok',
        ...(typeof result.itemName === 'string' ? { itemName: result.itemName } : {}),
        ...(typeof result.resultItem === 'string' ? { resultItem: result.resultItem } : {}),
        ...(typeof result.recipeId === 'string' ? { recipeId: result.recipeId } : {}),
        ...(Number.isInteger(result.timesCrafted) ? { timesCrafted: result.timesCrafted } : {}),
        ...(Number.isInteger(result.selectedSlot) ? { selectedSlot: result.selectedSlot } : {}),
        awaitingServerConfirmation: result.awaitingServerConfirmation === true
      } : {}),
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
    this.cancelPendingBlockPlacement('session_closed');
    this.cancelPendingCraft('session_closed');
    this.closed = true;
    stopLocalAutopilot(this, 'session_closed');
    if (this.watch) this.clearInterval(this.watch);
    if (this.controlWatch) this.clearInterval(this.controlWatch);
    this.watch = null;
    this.controlWatch = null;
    this.gameplayAgent?.stop('session_closed');
    this.pendingHotbarSelection = null;
    this.stackRequests.close('bedrock_session_closed');
    this.selectedHotbarSlot = null;
    this.lastHotbarSelection = null;
    this.autonomy?.stop('session_closed');
    this.blockBreaker?.abort('session_closed');
    this.movement?.stopPresence?.('session_closed');
    this.movement?.stop?.('session_closed');
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
