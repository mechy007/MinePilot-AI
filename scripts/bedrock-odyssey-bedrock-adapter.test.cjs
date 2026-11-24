'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CATALOG, planOdysseySkill, validateOdysseyCatalog } = require('./bedrock-odyssey-skill-library.cjs');
const { PRIMITIVES, evaluatePrimitive, buildBedrockPrimitivePlan, validatePrimitiveCoverage } =
  require('./bedrock-odyssey-bedrock-adapter.cjs');

test('all 183 ODYSSEY compositions map every referenced primitive to a Bedrock action contract', () => {
  assert.equal(CATALOG.compositions.length, 183);
  assert.equal(validatePrimitiveCoverage(CATALOG), true);
  assert.equal(validateOdysseyCatalog(), true);
  const referenced = new Set(CATALOG.compositions.flatMap(skill => skill.primitiveCalls));
  assert.deepEqual([...referenced].sort(), Object.keys(PRIMITIVES).sort());
});

test('Bedrock primitive evaluation never upgrades unsupported actions to executable', () => {
  const unsupported = ['craftItem','cookFood','smeltItem','equipArmor','equipAxe','equipHoe',
    'equipPickaxe','equipSword','feedAnimals','killMob','placeItem','plantSeeds'];
  for (const name of unsupported) {
    const result = evaluatePrimitive(name, { [PRIMITIVES[name].capability]: 'ready' });
    assert.equal(result.status, 'blocked', name);
    assert.equal(result.executable, false, name);
  }
});

test('observation and bounded navigation primitives inherit only advertised Bedrock capabilities', () => {
  assert.equal(evaluatePrimitive('checkBlocksAround',
    { spatial_observation: { state: 'ready', reason: 'decoded_bedrock_sections' } }).status, 'ready');
  assert.equal(evaluatePrimitive('goto',
    { navigation: { state: 'experimental', reason: 'server_verified_movement' } }).status, 'experimental');
  assert.equal(evaluatePrimitive('goto', {}).status, 'blocked');
  const partialNavigation = evaluatePrimitive('goto', { navigation: 'partial' });
  assert.equal(partialNavigation.status, 'partial');
  assert.equal(partialNavigation.executable, false);
  assert.equal(evaluatePrimitive('checkBlocksAround', { spatial_observation: 'partial' }).status, 'partial');
  const partialPlan = buildBedrockPrimitivePlan({ id: 'partial_observer', primitiveCalls: ['checkBlocksAround'] },
    { spatial_observation: 'partial' });
  assert.equal(partialPlan.status, 'partial');
  assert.equal(partialPlan.executable, false);
  assert.deepEqual(partialPlan.partialActions, ['checkBlocksAround']);
  assert.equal(evaluatePrimitive('mineBlock',
    { mine: { state: 'manual_experimental', reason: 'explicit_single_block_confirmation' } }).status, 'manual');
});

test('Bedrock skill plans preserve primitive requirements and never claim dispatch', () => {
  const skill = CATALOG.compositions.find(item => item.id === 'craft_wooden_pickaxe') ??
    CATALOG.compositions.find(item => item.primitiveCalls.includes('craftItem'));
  assert.ok(skill);
  const plan = buildBedrockPrimitivePlan(skill, {
    inventory_read: 'ready', craft: 'ready', navigation: 'experimental'
  });
  assert.equal(plan.skillId, skill.id);
  assert.equal(plan.executable, false);
  assert.equal(plan.execution, 'bedrock_action_plan_only');
  assert.ok(plan.blockedActions.includes('craftItem'));
  const catalogPlan = planOdysseySkill(skill.id, {
    world_observation: 'ready', spatial_observation: 'ready', inventory_read: 'ready',
    navigation: 'experimental', craft: 'ready'
  });
  assert.ok(catalogPlan.bedrockPlan);
  assert.equal(catalogPlan.executable, false);
  assert.equal(catalogPlan.arbitraryCodeExecution, false);
});

test('invalid skill definitions are rejected without creating actions', () => {
  assert.deepEqual(buildBedrockPrimitivePlan(null), {
    status: 'rejected', reason: 'invalid_skill_definition', executable: false, actions: []
  });
});
