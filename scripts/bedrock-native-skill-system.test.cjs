'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bedrockNativeSkillCatalog, evaluateBedrockSkill, startBedrockNativeSkill
} = require('./bedrock-native-skill-system.cjs');

function fixture() {
  const world = {
    closed: false, spawned: true, position: { x: 8.5, y: 64, z: 10.5 },
    positionUsable: () => true, commandsEnabled: true, permissionLevel: 'operator',
    lifeSenses: {}, intelligence: {}, clock: () => 1000,
    inventoryLedger: { playerInventory: () => ({
      known: true, fresh: true, registryKnown: true, unresolvedItemCount: 0
    }) }
  };
  const manifest = {
    worldReady: true, localNavigationReady: true,
    skills: [
      { name: 'follow_player', state: 'experimental', reason: 'selected_player' },
      { name: 'return_home', state: 'experimental', reason: 'marked_home' },
      { name: 'collect_observed_drops', state: 'experimental', reason: 'observed_drop' },
      { name: 'hotbar_selection', state: 'experimental', reason: 'fresh_hotbar' },
      { name: 'mine', state: 'manual_experimental', reason: 'single_block' }
    ]
  };
  return { world, manifest };
}

test('catalog is explicitly Bedrock-native and never advertises Java runtime execution', () => {
  const { world, manifest } = fixture();
  const catalog = bedrockNativeSkillCatalog(world, manifest);
  assert.equal(catalog.edition, 'minecraft_bedrock');
  assert.equal(catalog.source, 'minepilot_native');
  assert.equal(catalog.policy.javaEditionRuntime, false);
  assert.equal(catalog.policy.mineflayerRuntime, false);
  assert.ok(catalog.skills.length >= 10);
  assert.equal(catalog.skills.find(skill => skill.id === 'place_single_block').status, 'manual_experimental');
  assert.ok(catalog.skills.every(skill => skill.edition === 'bedrock'));
  assert.equal(catalog.roadmap.find(skill => skill.id === 'craft_items').status, 'partial');
  assert.ok(catalog.roadmap.filter(skill => skill.id !== 'craft_items').every(skill => skill.status === 'unsupported'));
});

test('world and inventory inspection require live Bedrock evidence', () => {
  const { world, manifest } = fixture();
  assert.equal(evaluateBedrockSkill({ id: 'inspect_world' }, world, manifest).status, 'ready');
  assert.equal(evaluateBedrockSkill({ id: 'inspect_inventory' }, world, manifest).status, 'ready');
  world.inventoryLedger.playerInventory = () => ({ known: true, fresh: false });
  assert.equal(evaluateBedrockSkill({ id: 'inspect_inventory' }, world, manifest).status, 'blocked');
  assert.equal(evaluateBedrockSkill({ id: 'inspect_world' }, world, { worldReady: false }).status, 'blocked');
});

test('navigation skills require Bedrock navigation, perception and intelligence', () => {
  const { world, manifest } = fixture();
  const skill = { id: 'safe_exploration', mode: 'bounded_agent', requires: ['explore'] };
  assert.equal(evaluateBedrockSkill(skill, world, manifest).status, 'experimental');
  world.intelligence = null;
  assert.equal(evaluateBedrockSkill(skill, world, manifest).reason, 'perception_or_intelligence_unavailable');
  manifest.localNavigationReady = false;
  assert.equal(evaluateBedrockSkill(skill, world, manifest).status, 'blocked');
});

test('follow, home and drop skills depend on the matching live Bedrock capability', () => {
  const { world, manifest } = fixture();
  for (const [id, name] of [
    ['follow_player', 'follow_player'],
    ['return_home', 'return_home'],
    ['retrieve_observed_drop', 'collect_observed_drops']
  ]) {
    const definition = require('./bedrock-native-skill-system.cjs').DEFINITIONS.find(item => item.id === id);
    assert.equal(evaluateBedrockSkill(definition, world, manifest).status, 'experimental');
    const altered = { ...manifest, skills: manifest.skills.filter(item => item.name !== name) };
    assert.equal(evaluateBedrockSkill(definition, world, altered).status, 'blocked');
  }
});

test('native composite dispatch maps only to existing Bedrock learning tasks and requires confirmation', () => {
  const { world, manifest } = fixture();
  let received = null;
  const engine = { start: (...args) => { received = args; return { status: 'accepted' }; } };
  assert.equal(startBedrockNativeSkill(world, manifest, engine, 'safe_exploration').reason, 'confirmation_required');
  assert.equal(startBedrockNativeSkill(world, manifest, engine, 'safe_exploration', { confirmed: true }).status, 'accepted');
  assert.equal(received[2], 'safe_exploration');
  assert.equal(received[3].confirmed, true);
});

test('read-only and experimental skills cannot be routed through composite task dispatch', () => {
  const { world, manifest } = fixture();
  const engine = { start: () => { throw new Error('must not dispatch'); } };
  assert.equal(startBedrockNativeSkill(world, manifest, engine, 'inspect_world', { confirmed: true }).reason,
    'read_only_skill_does_not_start_gameplay_task');
  assert.equal(startBedrockNativeSkill(world, manifest, engine, 'mine_single_block', { confirmed: true }).reason,
    'manual_experimental_executor_requires_dedicated_action_path');
  assert.equal(startBedrockNativeSkill(world, manifest, engine, 'place_single_block', { confirmed: true }).reason,
    'manual_experimental_executor_requires_dedicated_action_path');
  assert.equal(startBedrockNativeSkill(world, manifest, engine, 'unknown_skill', { confirmed: true }).reason,
    'unknown_bedrock_native_skill');
});


test('single-block placement is visible only with fresh world and Bedrock operator command permission', () => {
  const { world, manifest } = fixture();
  const definition = require('./bedrock-native-skill-system.cjs').DEFINITIONS
    .find(item => item.id === 'place_single_block');
  assert.equal(evaluateBedrockSkill(definition, world, manifest).status, 'manual_experimental');
  world.permissionLevel = 'member';
  assert.equal(evaluateBedrockSkill(definition, world, manifest).reason,
    'bedrock_operator_command_permission_required');
  world.permissionLevel = 'operator';
  world.commandsEnabled = false;
  assert.equal(evaluateBedrockSkill(definition, world, manifest).status, 'blocked');
  world.commandsEnabled = true;
  world.positionUsable = () => false;
  assert.equal(evaluateBedrockSkill(definition, world, manifest).reason,
    'fresh_server_position_required');
});

test('recipe crafting is experimental only when the live Bedrock craft capability is advertised', () => {
  const { world, manifest } = fixture();
  const definition = require('./bedrock-native-skill-system.cjs').DEFINITIONS
    .find(item => item.id === 'craft_recipe');
  assert.equal(evaluateBedrockSkill(definition, world, manifest).status, 'blocked');
  manifest.skills.push({ name: 'craft', state: 'manual_experimental', reason: 'server_recipe_catalog' });
  assert.equal(evaluateBedrockSkill(definition, world, manifest).status, 'manual_experimental');
  const engine = { start: () => { throw new Error('crafting must use the dedicated Bedrock transaction executor'); } };
  assert.equal(startBedrockNativeSkill(world, manifest, engine, 'craft_recipe', { confirmed: true }).reason,
    'manual_experimental_executor_requires_dedicated_action_path');
});
