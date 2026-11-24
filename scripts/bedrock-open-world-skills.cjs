'use strict';

const { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const VERSION = 'minepilot.voyager-odyssey.v1';
const MAX_STORE_BYTES = 256 * 1024;
const MAX_PROPOSALS = 64;
const MAX_RUNS = 80;
const MAX_STEPS = 8;
const MIN_MASTERY_RUNS = 3;
const MIN_MASTERY_SESSIONS = 2;

const PRIMITIVES = Object.freeze([
  { id: 'observe_world', kind: 'observation', description: 'Read the authenticated Bedrock world snapshot.' },
  { id: 'inspect_vitals', kind: 'observation', description: 'Inspect available survival and life-sense observations.' },
  { id: 'check_world_safety', kind: 'guard', description: 'Check fresh position, terrain, survival and movement gates.' },
  { id: 'verify_server_progress', kind: 'critic', description: 'Accept only fresh server-confirmed movement or inventory evidence.' },
  { id: 'explore_safe_terrain', kind: 'agent_goal', goal: 'explore', description: 'Explore only collision-classified safe terrain.' },
  { id: 'survival_patrol', kind: 'agent_goal', goal: 'survive', description: 'Prioritize safe retreat from recognized hostiles and survival needs.' },
  { id: 'follow_selected_player', kind: 'agent_goal', goal: 'follow', description: 'Follow an already selected visible player.' },
  { id: 'return_to_marked_home', kind: 'agent_goal', goal: 'return_home', description: 'Return to a previously marked home in the same dimension.' },
  { id: 'collect_selected_drop', kind: 'agent_goal', goal: 'gather', description: 'Approach an observed drop and verify the inventory increase.' }
]);
const PRIMITIVE_BY_ID = new Map(PRIMITIVES.map(item => [item.id, item]));

const COMPOSITE_SKILLS = Object.freeze([
  {
    id: 'survival_patrol',
    title: 'Survival patrol and threat response',
    description: 'Observe the world, check safety, use the existing survival agent, then verify progress.',
    steps: ['observe_world', 'inspect_vitals', 'check_world_safety', 'survival_patrol', 'verify_server_progress'],
    goal: 'survive', priority: 120, minimumVerifiedSteps: 3,
    successReasons: ['gameplay_run_budget_exhausted']
  },
  {
    id: 'safe_exploration',
    title: 'Safe terrain exploration',
    description: 'Explore known walkable terrain and require server-confirmed waypoint progress.',
    steps: ['observe_world', 'check_world_safety', 'explore_safe_terrain', 'verify_server_progress'],
    goal: 'explore', priority: 85, minimumVerifiedSteps: 3,
    successReasons: ['gameplay_run_budget_exhausted']
  },
  {
    id: 'return_home',
    title: 'Return to marked home',
    description: 'Validate the marked home and follow the existing bounded route executor.',
    steps: ['observe_world', 'check_world_safety', 'return_to_marked_home', 'verify_server_progress'],
    goal: 'return_home', priority: 70, minimumVerifiedSteps: 1,
    successReasons: ['target_reached']
  },
  {
    id: 'escort_selected_player',
    title: 'Escort selected player',
    description: 'Use a previously selected player target and the verified Bedrock follow route.',
    steps: ['observe_world', 'check_world_safety', 'follow_selected_player', 'verify_server_progress'],
    goal: 'follow', priority: 65, minimumVerifiedSteps: 1,
    successReasons: ['target_reached']
  },
  {
    id: 'retrieve_selected_drop',
    title: 'Retrieve observed item drop',
    description: 'Approach a previously selected visible drop and verify the inventory delta.',
    steps: ['observe_world', 'check_world_safety', 'collect_selected_drop', 'verify_server_progress'],
    goal: 'gather', priority: 55, minimumVerifiedSteps: 1,
    successReasons: ['server_confirmed_item_pickup']
  }
]);

const finiteInt = (value, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= 0 && value <= max;
const clone = value => JSON.parse(JSON.stringify(value));

function safeProposal(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (typeof input.id !== 'string' || !/^[a-z][a-z0-9_]{2,47}$/.test(input.id)) return null;
  if (COMPOSITE_SKILLS.some(item => item.id === input.id)) return null;
  if (typeof input.title !== 'string' || input.title.trim().length < 3 || input.title.length > 100) return null;
  if (typeof input.description !== 'string' || input.description.length > 240) return null;
  if (!Array.isArray(input.steps) || input.steps.length < 2 || input.steps.length > MAX_STEPS) return null;
  const steps = input.steps;
  if (!steps.every(step => typeof step === 'string' && PRIMITIVE_BY_ID.has(step))) return null;
  const goalSteps = steps.map(step => PRIMITIVE_BY_ID.get(step)).filter(step => step.kind === 'agent_goal');
  if (goalSteps.length !== 1 || goalSteps[0].goal !== input.goal) return null;
  if (!['survive', 'explore', 'follow', 'return_home', 'gather'].includes(input.goal)) return null;
  return {
    id: input.id,
    title: input.title.trim(),
    description: input.description.trim(),
    steps: [...steps],
    goal: input.goal,
    status: 'proposed',
    createdAt: finiteInt(input.createdAt) ? input.createdAt : Date.now()
  };
}

function capabilityState(manifest, name) {
  return manifest?.skills?.find(item => item.name === name)?.state ?? 'blocked';
}

function taskPreflight(world, manifest, task) {
  if (!world || world.closed) return 'session_closed';
  if (!manifest?.worldReady) return 'world_not_ready';
  if (world.gameplayWorld?.().safetyHold) return 'survival_safety_override';
  if (!world.gameplayAgent || typeof world.gameplayAgent.start !== 'function') return 'gameplay_agent_unavailable';
  if (['explore', 'survive'].includes(task.goal) && !manifest.localNavigationReady)
    return 'verified_navigation_unavailable';
  if (task.goal === 'follow') {
    const layer = world.layerTwo?.snapshot?.(world.gameplayWorld?.()) ?? {};
    if (layer?.preview?.goal !== 'follow') return 'select_follow_player_first';
    if (capabilityState(manifest, 'follow_player') === 'blocked') return 'follow_capability_unavailable';
  }
  if (task.goal === 'return_home') {
    const layer = world.layerTwo?.snapshot?.(world.gameplayWorld?.()) ?? {};
    if (layer?.homeKnown !== true) return 'mark_home_first';
    if (capabilityState(manifest, 'return_home') === 'blocked') return 'return_home_unavailable';
  }
  if (task.goal === 'gather') {
    const layer = world.layerThree?.snapshot?.(world.gameplayWorld?.()) ?? {};
    const preview = world.layerThree?.preview?.(world.gameplayWorld?.());
    if (!layer.inventoryKnown || !Array.isArray(layer.nearbyItemNames) ||
        layer.nearbyItemNames.length === 0 || !preview || preview.status === 'idle')
      return 'select_observed_drop_first';
    if (capabilityState(manifest, 'collect_observed_drops') === 'blocked')
      return 'drop_collection_unavailable';
  }
  if (task.goal === 'explore' && capabilityState(manifest, 'explore') === 'blocked')
    return 'exploration_unavailable';
  return null;
}

function improvementHint(reason) {
  const hints = {
    server_movement_not_confirmed: 'Refresh the server position and terrain observations before another attempt.',
    server_correction_not_verified_progress: 'Replan around the server correction; do not repeat the rejected waypoint.',
    no_safe_exploration_route: 'Load more decoded chunks and verify a collision-safe route.',
    verified_terrain_unavailable: 'Wait for Bedrock terrain decoding and collision classification.',
    target_not_visible: 'Refresh player or home observations and select the target again.',
    item_drop_unavailable: 'Select a currently observed drop and confirm the inventory baseline.',
    player_died: 'Stop learning and restore survival readiness before retrying.',
    gameplay_run_budget_exhausted: 'The bounded run ended; inspect verified progress before extending the objective.'
  };
  return hints[reason] ?? 'Re-observe the world, preserve the failure evidence, and request a new bounded plan.';
}

class BedrockOpenWorldLearningEngine {
  constructor(options = {}) {
    this.clock = options.clock ?? Date.now;
    this.storagePath = typeof options.storagePath === 'string' && options.storagePath.length < 1024
      ? options.storagePath : null;
    this.sessionId = options.sessionId ?? randomUUID();
    this.proposals = new Map();
    this.stats = new Map();
    this.learned = new Map();
    this.recentRuns = [];
    this.totalVerifiedSteps = 0;
    this.lastCounters = { gameplayAgent: 0, autonomy: 0 };
    this.lastPersistError = null;
    this.activeRun = null;
    this.legacySkillCount = 0;
    this.load();
  }

  load() {
    if (!this.storagePath || !existsSync(this.storagePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.storagePath, 'utf8'));
      if (raw?.version === 'minepilot.voyager-learning.v1') {
        this.totalVerifiedSteps = finiteInt(raw.totalVerifiedSteps, 10000000) ? raw.totalVerifiedSteps : 0;
        this.legacySkillCount = Array.isArray(raw.skills) ? Math.min(raw.skills.length, 128) : 0;
        return;
      }
      if (raw?.version !== VERSION) return;
      this.totalVerifiedSteps = finiteInt(raw.totalVerifiedSteps, 10000000) ? raw.totalVerifiedSteps : 0;
      if (Array.isArray(raw.proposals)) {
        for (const value of raw.proposals.slice(0, MAX_PROPOSALS)) {
          const proposal = safeProposal(value);
          if (proposal) {
            proposal.status = value.status === 'verified' ? 'verified' : 'proposed';
            this.proposals.set(proposal.id, proposal);
          }
        }
      }
      if (Array.isArray(raw.stats)) {
        for (const entry of raw.stats.slice(0, 128)) {
          if (!entry || typeof entry.id !== 'string' || !/^[a-z][a-z0-9_]{2,47}$/.test(entry.id)) continue;
          const sessions = Array.isArray(entry.successSessions)
            ? [...new Set(entry.successSessions.filter(x => typeof x === 'string').slice(-8))] : [];
          this.stats.set(entry.id, {
            id: entry.id,
            attempts: finiteInt(entry.attempts, 100000) ? entry.attempts : 0,
            successes: finiteInt(entry.successes, 100000) ? entry.successes : 0,
            failures: finiteInt(entry.failures, 100000) ? entry.failures : 0,
            interrupted: finiteInt(entry.interrupted, 100000) ? entry.interrupted : 0,
            successSessions: sessions,
            lastOutcome: typeof entry.lastOutcome === 'string' ? entry.lastOutcome.slice(0, 48) : 'unknown',
            lastReason: typeof entry.lastReason === 'string' ? entry.lastReason.slice(0, 80) : 'unknown'
          });
        }
      }
      if (Array.isArray(raw.learned)) {
        for (const item of raw.learned.slice(0, 128)) {
          if (typeof item?.id === 'string' && this.stats.has(item.id) &&
              item.status === 'verified' && finiteInt(item.verifiedRuns, 100000)) {
            this.learned.set(item.id, {
              id: item.id,
              verifiedRuns: item.verifiedRuns,
              successSessions: Array.isArray(item.successSessions) ? item.successSessions.slice(-8) : []
            });
          }
        }
      }
      this.recentRuns = Array.isArray(raw.recentRuns) ? raw.recentRuns.slice(-MAX_RUNS) : [];
    } catch {
      this.lastPersistError = 'learning_store_unreadable';
    }
  }

  persist() {
    if (!this.storagePath) return false;
    const temp = this.storagePath + '.' + randomUUID() + '.tmp';
    try {
      mkdirSync(path.dirname(this.storagePath), { recursive: true });
      const payload = {
        version: VERSION,
        totalVerifiedSteps: this.totalVerifiedSteps,
        proposals: [...this.proposals.values()].slice(0, MAX_PROPOSALS),
        stats: [...this.stats.values()].slice(0, 128),
        learned: [...this.learned.values()].map(item => ({ ...item, status: 'verified' })).slice(0, 128),
        recentRuns: this.recentRuns.slice(-MAX_RUNS)
      };
      const serialized = JSON.stringify(payload);
      if (Buffer.byteLength(serialized, 'utf8') > MAX_STORE_BYTES) {
        this.lastPersistError = 'learning_store_size_limit';
        return false;
      }
      writeFileSync(temp, serialized, { flag: 'wx', mode: 0o600 });
      renameSync(temp, this.storagePath);
      this.lastPersistError = null;
      return true;
    } catch {
      try { unlinkSync(temp); } catch {}
      this.lastPersistError = 'learning_store_write_failed';
      return false;
    }
  }

  taskById(taskId) {
    const builtin = COMPOSITE_SKILLS.find(item => item.id === taskId);
    if (builtin) return builtin;
    const proposal = this.proposals.get(taskId);
    if (!proposal) return null;
    const goalStep = proposal.steps.map(step => PRIMITIVE_BY_ID.get(step))
      .find(step => step.kind === 'agent_goal');
    return goalStep ? {
      id: proposal.id,
      title: proposal.title,
      description: proposal.description,
      steps: [...proposal.steps],
      goal: goalStep.goal,
      priority: 25,
      minimumVerifiedSteps: goalStep.goal === 'explore' || goalStep.goal === 'survive' ? 3 : 1,
      successReasons: goalStep.goal === 'follow' || goalStep.goal === 'return_home'
        ? ['target_reached']
        : goalStep.goal === 'gather'
          ? ['server_confirmed_item_pickup'] : ['gameplay_run_budget_exhausted'],
      proposed: true
    } : null;
  }

  buildPlan(world, manifest, taskId) {
    const task = this.taskById(taskId);
    if (!task) return { status: 'rejected', reason: 'unknown_learning_task' };
    const blocker = taskPreflight(world, manifest, task);
    if (blocker) return { status: 'rejected', reason: blocker };
    return {
      status: 'ready',
      taskId: task.id,
      title: task.title,
      goal: task.goal,
      steps: [...task.steps],
      execution: 'existing_bedrock_gameplay_agent',
      successCriteria: task.goal === 'explore' || task.goal === 'survive'
        ? { type: 'server_verified_steps', minimum: task.minimumVerifiedSteps }
        : { type: 'verified_terminal_reason', anyOf: [...task.successReasons] },
      arbitraryCodeExecution: false
    };
  }

  start(world, manifest, taskId, options = {}) {
    if (options.confirmed !== true) return { status: 'rejected', reason: 'confirmation_required' };
    if (this.activeRun) return { status: 'rejected', reason: 'learning_task_already_active' };
    if (world?.gameplayAgent?.snapshot?.()?.active) return { status: 'rejected', reason: 'gameplay_agent_busy' };
    const plan = this.buildPlan(world, manifest, taskId);
    if (plan.status !== 'ready') return plan;
    const started = world.gameplayAgent.start(world, { confirmed: true, goal: plan.goal });
    if (started?.status !== 'accepted') return started ?? { status: 'rejected', reason: 'gameplay_agent_start_failed' };
    this.activeRun = {
      taskId: plan.taskId,
      goal: plan.goal,
      steps: plan.steps,
      title: plan.title,
      startedAt: this.clock(),
      sessionId: this.sessionId,
      requestedStop: false,
      seenActive: true
    };
    if (this.proposals.has(taskId)) {
      const proposal = this.proposals.get(taskId);
      proposal.status = 'proposed';
    }
    this.persist();
    return { status: 'accepted', reason: 'learning_actor_started', taskId: plan.taskId, plan };
  }

  stop(world, reason = 'learning_user_stopped') {
    if (!this.activeRun) return { status: 'ok', reason: 'no_learning_task_active' };
    this.activeRun.requestedStop = true;
    world?.gameplayAgent?.stop?.(reason);
    this.observe(world, null);
    return { status: 'ok', reason: 'learning_task_stop_requested' };
  }

  propose(input) {
    const proposal = safeProposal(input);
    if (!proposal) return { status: 'rejected', reason: 'proposal_not_a_valid_declarative_skill' };
    if (this.proposals.size >= MAX_PROPOSALS && !this.proposals.has(proposal.id))
      return { status: 'rejected', reason: 'proposal_library_full' };
    const previous = this.proposals.get(proposal.id);
    this.proposals.set(proposal.id, proposal);
    if (this.storagePath && !this.persist()) {
      if (previous) this.proposals.set(proposal.id, previous);
      else this.proposals.delete(proposal.id);
      return { status: 'rejected', reason: this.lastPersistError ?? 'learning_store_write_failed' };
    }
    return { status: 'accepted', reason: 'declarative_skill_proposal_saved_for_review', skillId: proposal.id };
  }

  updateCounters(world) {
    let changed = false;
    const sources = [
      ['gameplayAgent', world?.gameplayAgent?.snapshot?.()?.serverVerifiedSteps],
      ['autonomy', world?.autonomy?.snapshot?.()?.serverVerifiedSteps]
    ];
    for (const [name, raw] of sources) {
      if (!finiteInt(raw, 10000000)) continue;
      const previous = this.lastCounters[name] ?? 0;
      if (raw >= previous) {
        const delta = raw - previous;
        if (delta > 0) {
          this.totalVerifiedSteps = Math.min(10000000, this.totalVerifiedSteps + delta);
          changed = true;
        }
      }
      this.lastCounters[name] = raw;
    }
    if (changed && this.totalVerifiedSteps % 5 === 0) this.persist();
  }

  critic(task, agent, activeRun) {
    const reason = typeof agent.reason === 'string' ? agent.reason : 'unknown';
    const verified = finiteInt(agent.serverVerifiedSteps, 100000) ? agent.serverVerifiedSteps : 0;
    const terminalSuccess = task.successReasons.includes(reason);
    const progressSuccess = ['explore', 'survive'].includes(task.goal) &&
      reason === 'gameplay_run_budget_exhausted' && verified >= task.minimumVerifiedSteps;
    if (activeRun.requestedStop || ['learning_user_stopped', 'user_stopped', 'user_stop', 'session_closed'].includes(reason))
      return { outcome: 'interrupted', reason, verified, improvementHint: 'Resume only after reviewing the current world and safety state.' };
    if (terminalSuccess || progressSuccess)
      return { outcome: 'verified', reason, verified, improvementHint: 'Success was established by Bedrock server observations.' };
    return { outcome: 'failed', reason, verified, improvementHint: improvementHint(reason) };
  }

  recordRun(task, result, activeRun) {
    const current = this.stats.get(task.id) ?? {
      id: task.id, attempts: 0, successes: 0, failures: 0, interrupted: 0,
      successSessions: [], lastOutcome: 'not_run', lastReason: 'none'
    };
    current.attempts++;
    if (result.outcome === 'verified') {
      current.successes++;
      current.successSessions = [...new Set([...current.successSessions, activeRun.sessionId])].slice(-8);
    } else if (result.outcome === 'failed') current.failures++;
    else current.interrupted++;
    current.lastOutcome = result.outcome;
    current.lastReason = result.reason;
    this.stats.set(task.id, current);
    this.recentRuns.push({
      taskId: task.id, goal: task.goal, outcome: result.outcome, reason: result.reason,
      verifiedSteps: result.verified, at: this.clock()
    });
    if (this.recentRuns.length > MAX_RUNS) this.recentRuns.shift();

    if (result.outcome === 'verified' &&
        current.successes >= MIN_MASTERY_RUNS &&
        current.successSessions.length >= MIN_MASTERY_SESSIONS) {
      this.learned.set(task.id, {
        id: task.id,
        verifiedRuns: current.successes,
        successSessions: [...current.successSessions]
      });
      const proposal = this.proposals.get(task.id);
      if (proposal) proposal.status = 'verified';
    }
    this.persist();
  }

  observe(world, manifest) {
    if (!world) return this.snapshot(null, manifest);
    this.updateCounters(world);
    if (this.activeRun) {
      const agent = world.gameplayAgent?.snapshot?.() ?? {};
      if (agent.active) {
        this.activeRun.seenActive = true;
      } else if (this.activeRun.seenActive) {
        const task = this.taskById(this.activeRun.taskId);
        if (task) this.recordRun(task, this.critic(task, agent, this.activeRun), this.activeRun);
        this.activeRun = null;
      }
    }
    return this.snapshot(world, manifest);
  }

  curriculum(world, manifest) {
    if (this.activeRun) {
      const task = this.taskById(this.activeRun.taskId);
      return task ? { id: task.id, title: task.title, goal: task.goal, status: 'running' } : null;
    }
    const life = world?.lifeSenses?.snapshot?.({
      position: world.position, dimension: world.dimension, spawned: world.spawned,
      closed: world.closed, respawnState: world.respawnRecovery?.state, terrain: world.terrain
    }) ?? {};
    const threatened = Array.isArray(life.nearbyEntities) &&
      life.nearbyEntities.some(item => item?.hostile === true && Number.isFinite(item.distance) && item.distance <= 8);
    const candidates = [];
    for (const task of COMPOSITE_SKILLS) {
      if (this.learned.has(task.id)) continue;
      const blocker = taskPreflight(world, manifest, task);
      if (!blocker) candidates.push({ id: task.id, title: task.title, goal: task.goal,
        priority: task.id === 'survival_patrol' && threatened ? 200 : task.priority,
        status: 'recommended' });
    }
    for (const proposal of this.proposals.values()) {
      if (proposal.status !== 'proposed' || this.learned.has(proposal.id)) continue;
      const task = this.taskById(proposal.id);
      if (task && !taskPreflight(world, manifest, task))
        candidates.push({ id: task.id, title: task.title, goal: task.goal,
          priority: task.priority, status: 'proposed' });
    }
    candidates.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    return candidates[0] ?? null;
  }

  snapshot(world, manifest) {
    const agent = world?.gameplayAgent?.snapshot?.() ?? {};
    const activeTask = this.activeRun ? {
      id: this.activeRun.taskId,
      title: this.activeRun.title,
      goal: this.activeRun.goal,
      startedAt: this.activeRun.startedAt,
      phase: agent.phase ?? 'starting',
      active: Boolean(agent.active),
      verifiedSteps: agent.serverVerifiedSteps ?? 0,
      reason: agent.reason ?? 'running'
    } : null;
    return {
      version: VERSION,
      architecture: ['automatic_curriculum', 'primitive_and_compositional_skills', 'planner_actor_critic', 'persistent_verified_skill_memory'],
      mode: 'bedrock_native_voyager_odyssey',
      primitiveSkillCount: PRIMITIVES.length,
      compositionalSkillCount: COMPOSITE_SKILLS.length + this.proposals.size,
      proposedSkillCount: [...this.proposals.values()].filter(item => item.status === 'proposed').length,
      learnedSkillCount: this.learned.size,
      totalVerifiedNavigationSteps: this.totalVerifiedSteps,
      nextCurriculumTask: this.curriculum(world, manifest),
      activeTask,
      skills: [...COMPOSITE_SKILLS.map(item => ({
        id: item.id, title: item.title, goal: item.goal,
        status: this.learned.has(item.id) ? 'verified' : 'available',
        verifiedRuns: this.stats.get(item.id)?.successes ?? 0
      })), ...[...this.proposals.values()].map(item => ({
        id: item.id, title: item.title, goal: item.goal,
        status: item.status,
        verifiedRuns: this.stats.get(item.id)?.successes ?? 0
      }))],
      recentRuns: this.recentRuns.slice(-12).map(item => ({ ...item })),
      arbitraryCodeExecution: false,
      generatedSkillRuntime: 'disabled_model_outputs_are_declarative_only',
      persistence: this.storagePath ? (this.lastPersistError ? 'error' : 'enabled') : 'session_only',
      persistenceError: this.lastPersistError,
      legacyVoyagerRecordsPreserved: this.legacySkillCount
    };
  }

  catalog() {
    return {
      version: VERSION,
      primitives: PRIMITIVES.map(item => ({ ...item })),
      compositions: COMPOSITE_SKILLS.map(item => ({ ...item, steps: [...item.steps], successReasons: [...item.successReasons] })),
      proposalSchema: {
        required: ['id', 'title', 'description', 'goal', 'steps'],
        allowedPrimitiveIds: PRIMITIVES.map(item => item.id),
        maxSteps: MAX_STEPS,
        exactlyOneAgentGoal: true,
        executableCode: false
      }
    };
  }
}

module.exports = {
  VERSION, PRIMITIVES, COMPOSITE_SKILLS, BedrockOpenWorldLearningEngine,
  safeProposal, taskPreflight, improvementHint
};
