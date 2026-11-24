'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  PRIMITIVES, COMPOSITE_SKILLS, BedrockOpenWorldLearningEngine,
  safeProposal
} = require('./bedrock-open-world-skills.cjs');
const { gameplaySkillManifest, startLearningTask, stopLearningTask, proposeLearningSkill } =
  require('./bedrock-skill-manifest.cjs');

function worldFixture() {
  let now = 1000;
  let agent = { active: false, goal: 'none', phase: 'idle', reason: 'idle',
    serverVerifiedSteps: 0, failures: 0 };
  const world = {
    commandPath: null,
    clock: () => now,
    closed: false,
    spawned: true,
    position: { x: 1, y: 64, z: 1 },
    dimension: 0,
    lastServerPositionAt: now,
    movementAuthority: 1,
    terrain: { snapshot: () => ({ collisionClassificationReady: true, decodedSections: 1 }) },
    movement: { capability: () => 'experimental' },
    layerTwo: {
      snapshot: () => ({ preview: { goal: 'follow' }, homeKnown: true }),
      preview: () => ({ goal: 'follow', status: 'route_unverified', nextPoint: { x: 5, y: 64, z: 1 } })
    },
    layerThree: {
      snapshot: () => ({ inventoryKnown: true, nearbyItemNames: ['minecraft:apple'] }),
      preview: () => ({ status: 'route_unverified', itemName: 'minecraft:apple' })
    },
    lifeSenses: { snapshot: () => ({ health: 20, hunger: 20, nearbyEntities: [] }) },
    intelligence: { snapshot: () => ({ goal: 'standby' }) },
    gameplayAgent: {
      start(_world, opts) {
        if (opts.confirmed !== true) return { status: 'rejected', reason: 'confirmation_required' };
        agent = { active: true, goal: opts.goal, phase: 'observing',
          reason: 'running', serverVerifiedSteps: 0, failures: 0 };
        return { status: 'accepted', reason: 'started' };
      },
      stop(reason) {
        agent = { ...agent, active: false, phase: 'idle', reason };
        return { status: 'ok', reason };
      },
      snapshot: () => ({ ...agent })
    },
    autonomy: { snapshot: () => ({ active: false, serverVerifiedSteps: 0 }) },
    gameplayWorld: () => ({ safetyHold: false, position: world.position,
      dimension: world.dimension, spawned: world.spawned })
  };
  return {
    world,
    setAgent(value) { agent = { ...agent, ...value }; },
    advance(ms) { now += ms; world.lastServerPositionAt = now; }
  };
}

test('ODYSSEY-style library exposes Bedrock-native primitives and compositions', () => {
  assert.ok(PRIMITIVES.length >= 8);
  assert.ok(COMPOSITE_SKILLS.length >= 4);
  assert.ok(COMPOSITE_SKILLS.every(skill =>
    skill.steps.every(step => PRIMITIVES.some(primitive => primitive.id === step))));
  assert.equal(COMPOSITE_SKILLS.find(skill => skill.id === 'safe_exploration').goal, 'explore');
});

test('task planner refuses to plan before live world and movement prerequisites are ready', () => {
  const { world } = worldFixture();
  const engine = new BedrockOpenWorldLearningEngine();
  const manifest = gameplaySkillManifest(world);
  assert.equal(engine.buildPlan({ ...world, spawned: false }, { ...manifest, worldReady: false }, 'safe_exploration').reason,
    'world_not_ready');
  world.terrain.snapshot = () => ({ collisionClassificationReady: false });
  const blocked = gameplaySkillManifest(world);
  assert.equal(engine.buildPlan(world, blocked, 'safe_exploration').reason, 'verified_navigation_unavailable');
});

test('curriculum recommends survival response ahead of exploration when a hostile is near', () => {
  const { world } = worldFixture();
  world.lifeSenses.snapshot = () => ({
    health: 20, hunger: 20, nearbyEntities: [{ hostile: true, distance: 4 }]
  });
  const manifest = gameplaySkillManifest(world);
  assert.equal(manifest.learning.nextCurriculumTask.id, 'survival_patrol');
});

test('actor requires explicit confirmation and starts only an existing Bedrock gameplay goal', () => {
  const { world } = worldFixture();
  const manifest = gameplaySkillManifest(world);
  const denied = startLearningTask(world, 'safe_exploration', { confirmed: false });
  assert.equal(denied.status, 'rejected');
  assert.equal(denied.reason, 'confirmation_required');
  const accepted = startLearningTask(world, 'safe_exploration', { confirmed: true });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.plan.execution, 'existing_bedrock_gameplay_agent');
  assert.equal(accepted.plan.arbitraryCodeExecution, false);
  assert.equal(world.gameplayAgent.snapshot().goal, 'explore');
  assert.ok(manifest.openWorldSkills.compositions.length >= 4);
});

test('critic promotes progress only after server-verified success and records failures separately', () => {
  const { world, setAgent } = worldFixture();
  const engine = new BedrockOpenWorldLearningEngine();
  const manifest = gameplaySkillManifest(world);
  assert.equal(engine.start(world, manifest, 'safe_exploration', { confirmed: true }).status, 'accepted');
  engine.observe(world, manifest);
  setAgent({ active: false, phase: 'idle', reason: 'gameplay_run_budget_exhausted', serverVerifiedSteps: 3 });
  let result = engine.observe(world, manifest);
  assert.equal(result.activeTask, null);
  assert.equal(result.recentRuns.at(-1).outcome, 'verified');

  assert.equal(engine.start(world, manifest, 'safe_exploration', { confirmed: true }).status, 'accepted');
  engine.observe(world, manifest);
  setAgent({ active: false, phase: 'idle', reason: 'server_movement_not_confirmed', serverVerifiedSteps: 0 });
  result = engine.observe(world, manifest);
  assert.equal(result.recentRuns.at(-1).outcome, 'failed');
  assert.match(result.recentRuns.at(-1).reason, /server_movement_not_confirmed/);
});

test('learning stop cancels only the active learned task and records an interruption', () => {
  const { world } = worldFixture();
  gameplaySkillManifest(world);
  assert.equal(startLearningTask(world, 'safe_exploration', { confirmed: true }).status, 'accepted');
  const stopped = stopLearningTask(world, 'learning_user_stopped');
  assert.equal(stopped.status, 'ok');
  const state = gameplaySkillManifest(world).learning;
  assert.equal(state.activeTask, null);
  assert.equal(state.recentRuns.at(-1).outcome, 'interrupted');
});

test('proposed skills are declarative only and reject executable model output', () => {
  const good = {
    id: 'custom_safe_scout',
    title: 'Safe scout variation',
    description: 'Observe, check safety, explore and verify progress.',
    goal: 'explore',
    steps: ['observe_world', 'check_world_safety', 'explore_safe_terrain', 'verify_server_progress']
  };
  assert.ok(safeProposal(good));
  assert.equal(safeProposal({ ...good, steps: ['observe_world', 'eval(require("child_process"))'] }), null);
  assert.equal(safeProposal({ ...good, steps: ['observe_world', 'explore_safe_terrain', 'survival_patrol'] }), null);
  const { world } = worldFixture();
  const accepted = proposeLearningSkill(world, good);
  assert.equal(accepted.status, 'accepted');
  const state = gameplaySkillManifest(world).learning;
  assert.equal(state.proposedSkillCount, 1);
  assert.equal(state.arbitraryCodeExecution, false);
});

test('persistent skill memory survives restart and promotes only after repeated success across sessions', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'minepilot-odyssey-'));
  try {
    const storagePath = path.join(directory, 'learning.json');
    const first = new BedrockOpenWorldLearningEngine({ storagePath, sessionId: 'session-a' });
    const task = COMPOSITE_SKILLS.find(item => item.id === 'safe_exploration');
    for (let n = 0; n < 2; n++) {
      first.recordRun(task, { outcome: 'verified', reason: 'gameplay_run_budget_exhausted', verified: 3 },
        { sessionId: 'session-a' });
    }
    const second = new BedrockOpenWorldLearningEngine({ storagePath, sessionId: 'session-b' });
    second.recordRun(task, { outcome: 'verified', reason: 'gameplay_run_budget_exhausted', verified: 4 },
      { sessionId: 'session-b' });
    assert.equal(second.snapshot(null, null).learnedSkillCount, 1);
    const restarted = new BedrockOpenWorldLearningEngine({ storagePath, sessionId: 'session-c' });
    assert.equal(restarted.snapshot(null, null).learnedSkillCount, 1);
    assert.equal(restarted.snapshot(null, null).totalVerifiedNavigationSteps, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('verified counters from the gameplay agent and autonomy runner are tracked independently', () => {
  const { world } = worldFixture();
  const engine = new BedrockOpenWorldLearningEngine();
  let state = engine.observe(world, gameplaySkillManifest(world));
  assert.equal(state.totalVerifiedNavigationSteps, 0);
  world.gameplayAgent.snapshot = () => ({ active: false, serverVerifiedSteps: 2 });
  world.autonomy.snapshot = () => ({ active: false, serverVerifiedSteps: 5 });
  state = engine.observe(world, gameplaySkillManifest(world));
  assert.equal(state.totalVerifiedNavigationSteps, 7);
  world.gameplayAgent.snapshot = () => ({ active: false, serverVerifiedSteps: 0 });
  state = engine.observe(world, gameplaySkillManifest(world));
  assert.equal(state.totalVerifiedNavigationSteps, 7);
  world.gameplayAgent.snapshot = () => ({ active: false, serverVerifiedSteps: 1 });
  state = engine.observe(world, gameplaySkillManifest(world));
  assert.equal(state.totalVerifiedNavigationSteps, 8);
});


test('legacy Voyager records migrate only when every stored step is in the previous allowlist', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'minepilot-voyager-migration-'));
  try {
    const storagePath = path.join(directory, 'learning.json');
    writeFileSync(storagePath, JSON.stringify({
      version: 'minepilot.voyager-learning.v1',
      totalVerifiedSteps: 17,
      skills: [
        {
          id: 'legacy_safe_route',
          title: 'Legacy safe route',
          goal: 'explore',
          status: 'verified',
          verifiedRuns: 3,
          steps: ['observe_world', 'plan_local_route', 'request_bounded_step', 'verify_server_position'],
          updatedAt: 123
        },
        {
          id: 'legacy_unsafe_route',
          title: 'Legacy unsafe route',
          goal: 'explore',
          status: 'verified',
          verifiedRuns: 5,
          steps: ['observe_world', 'eval_generated_code'],
          updatedAt: 124
        }
      ]
    }));
    const engine = new BedrockOpenWorldLearningEngine({ storagePath, sessionId: 'migration-session' });
    let state = engine.snapshot(null, null);
    assert.equal(state.totalVerifiedNavigationSteps, 17);
    assert.equal(state.legacyVoyagerRecordCountMigrated, 1);

    const task = COMPOSITE_SKILLS.find(item => item.id === 'safe_exploration');
    engine.recordRun(task, { outcome: 'verified', reason: 'gameplay_run_budget_exhausted', verified: 3 },
      { sessionId: 'migration-session' });
    const persisted = JSON.parse(readFileSync(storagePath, 'utf8'));
    assert.equal(persisted.version, 'minepilot.voyager-odyssey.v1');
    assert.equal(persisted.legacySkills.length, 1);
    assert.equal(persisted.legacySkills[0].id, 'legacy_safe_route');
    assert.ok(persisted.legacySkills[0].steps.every(step =>
      ['observe_world', 'plan_local_route', 'request_bounded_step',
        'verify_server_position', 'stop_on_hazard'].includes(step)));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test('local autopilot advances through built-in Bedrock tasks without external model prompts', () => {
  const { world, setAgent } = worldFixture();
  const engine = new BedrockOpenWorldLearningEngine({ sessionId: 'offline-session' });
  const manifest = gameplaySkillManifest(world);
  const enabled = engine.enableAutopilot(world, manifest, { confirmed: true });
  assert.equal(enabled.status, 'accepted');
  assert.equal(enabled.reason, 'local_autopilot_started');
  assert.equal(engine.snapshot(world, manifest).localAutopilot.enabled, true);
  assert.equal(world.gameplayAgent.snapshot().goal, 'survive');

  // A completed task is accepted only from the same server-verified terminal evidence
  // used by the existing Bedrock gameplay agent.
  setAgent({ active: false, phase: 'idle', reason: 'gameplay_run_budget_exhausted',
    serverVerifiedSteps: 3 });
  const next = engine.observe(world, manifest);
  assert.equal(next.recentRuns.at(-1).outcome, 'verified');
  assert.equal(next.localAutopilot.enabled, true);
  assert.equal(next.activeTask.goal, 'explore');
  assert.equal(world.gameplayAgent.snapshot().goal, 'explore');
  assert.equal(next.localAutopilot.attemptedThisSession, 2);
});

test('local autopilot requires one explicit enable and can be stopped immediately', () => {
  const { world } = worldFixture();
  const engine = new BedrockOpenWorldLearningEngine();
  const manifest = gameplaySkillManifest(world);
  assert.equal(engine.enableAutopilot(world, manifest, { confirmed: false }).reason,
    'confirmation_required');
  assert.equal(engine.snapshot(world, manifest).localAutopilot.enabled, false);
  assert.equal(engine.enableAutopilot(world, manifest, { confirmed: true }).status, 'accepted');
  const stopped = engine.disableAutopilot(world, 'user_disabled_autopilot');
  assert.equal(stopped.status, 'ok');
  const state = engine.snapshot(world, manifest);
  assert.equal(state.localAutopilot.enabled, false);
  assert.equal(state.activeTask, null);
  assert.equal(state.recentRuns.at(-1).outcome, 'interrupted');
});
