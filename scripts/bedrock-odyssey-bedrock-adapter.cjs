'use strict';

// Maps ODYSSEY's abstract primitive names to MinePilot-owned Bedrock capabilities.
// This module never imports or evaluates upstream Mineflayer code.
const PRIMITIVES = Object.freeze({
  checkBlockAbove: { capability: 'spatial_observation', action: 'inspect_block', mode: 'observe', executor: 'odyssey_observe' },
  checkBlocksAround: { capability: 'spatial_observation', action: 'inspect_nearby_blocks', mode: 'observe', executor: 'odyssey_observe' },
  findSuitablePosition: { capability: 'spatial_observation', action: 'find_safe_position', mode: 'observe', executor: 'odyssey_observe' },
  getLogsCount: { capability: 'inventory_read', action: 'count_inventory_item', mode: 'observe', executor: 'odyssey_observe' },
  getPlanksCount: { capability: 'inventory_read', action: 'count_inventory_item', mode: 'observe', executor: 'odyssey_observe' },
  goto: { capability: 'navigation', action: 'navigate_to_observed_target', mode: 'bounded', executor: 'odyssey_execute' },
  exploreUntil: { capability: 'navigation', action: 'explore_verified_terrain', mode: 'bounded', executor: 'odyssey_execute' },
  mineBlock: { capability: 'mine', action: 'break_observed_block', mode: 'manual_experimental', executor: 'odyssey_execute' },
  craftItem: { capability: 'craft', action: 'craft_recipe', mode: 'unsupported' },
  cookFood: { capability: 'cook', action: 'cook_food', mode: 'unsupported' },
  smeltItem: { capability: 'smelt', action: 'smelt_item', mode: 'unsupported' },
  equipArmor: { capability: 'equip_items', action: 'equip_armor', mode: 'unsupported' },
  equipAxe: { capability: 'hotbar_selection', action: 'select_hotbar_axe', mode: 'bounded', executor: 'odyssey_execute' },
  equipHoe: { capability: 'hotbar_selection', action: 'select_hotbar_hoe', mode: 'bounded', executor: 'odyssey_execute' },
  equipPickaxe: { capability: 'hotbar_selection', action: 'select_hotbar_pickaxe', mode: 'bounded', executor: 'odyssey_execute' },
  equipSword: { capability: 'hotbar_selection', action: 'select_hotbar_sword', mode: 'bounded', executor: 'odyssey_execute' },
  feedAnimals: { capability: 'breed_animals', action: 'feed_animals', mode: 'unsupported' },
  killMob: { capability: 'combat', action: 'attack_entity', mode: 'unsupported' },
  placeItem: { capability: 'block_placement', action: 'place_block', mode: 'unsupported' },
  plantSeeds: { capability: 'farming', action: 'plant_seeds', mode: 'unsupported' }
});

const USABLE_STATES = new Set(['ready', 'experimental', 'partial', 'manual_experimental']);
const stateOf = (capabilities, name) => {
  const value = capabilities?.[name];
  const state = typeof value === 'string' ? value : value?.state;
  return typeof state === 'string' ? state : 'blocked';
};
const reasonOf = (capabilities, name) => {
  const value = capabilities?.[name];
  return typeof value === 'object' && typeof value.reason === 'string'
    ? value.reason.slice(0, 120) : 'bedrock_capability_not_advertised';
};

function evaluatePrimitive(name, capabilities = {}) {
  const definition = PRIMITIVES[name];
  if (!definition) return { name, status: 'blocked', reason: 'unknown_upstream_primitive', executable: false };
  const capabilityState = stateOf(capabilities, definition.capability);
  const available = USABLE_STATES.has(capabilityState);
  const mode = definition.mode;
  const status = !available ? 'blocked'
    : mode === 'unsupported' ? 'blocked'
    : mode === 'manual_experimental' || capabilityState === 'manual_experimental' ? 'manual'
    : capabilityState === 'partial' ? 'partial'
    : mode === 'bounded' || capabilityState === 'experimental' ? 'experimental' : 'ready';
  return {
    name, action: definition.action, capability: definition.capability,
    capabilityState, status, executor: definition.executor ?? null, reason: available ? reasonOf(capabilities, definition.capability)
      : 'required_bedrock_action_not_implemented_or_unavailable',
    executable: status === 'ready' || status === 'experimental'
  };
}

function buildBedrockPrimitivePlan(skill, capabilities = {}) {
  if (!skill || typeof skill !== 'object' || !Array.isArray(skill.primitiveCalls))
    return { status: 'rejected', reason: 'invalid_skill_definition', executable: false, actions: [] };
  const actions = [...new Set(skill.primitiveCalls)].map(name => evaluatePrimitive(name, capabilities));
  const blocked = actions.filter(action => action.status === 'blocked');
  const manual = actions.filter(action => action.status === 'manual');
  const partial = actions.filter(action => action.status === 'partial');
  const experimental = actions.filter(action => action.status === 'experimental');
  const status = blocked.length ? 'blocked' : manual.length ? 'manual'
    : partial.length ? 'partial' : experimental.length ? 'experimental' : 'ready';
  return {
    status, skillId: skill.id, upstreamName: skill.upstreamName,
    actions, blockedActions: blocked.map(action => action.name),
    manualActions: manual.map(action => action.name),
    partialActions: partial.map(action => action.name),
    experimentalActions: experimental.map(action => action.name),
    // A plan is not an execution receipt. Runtime dispatch remains disabled
    // until every action has a concrete Bedrock executor and server verifier.
    executable: false, execution: 'bedrock_action_plan_only',
    arbitraryCodeExecution: false
  };
}

function validatePrimitiveCoverage(catalog) {
  if (!catalog || !Array.isArray(catalog.compositions)) return false;
  for (const skill of catalog.compositions) {
    if (!Array.isArray(skill.primitiveCalls)) return false;
    if (skill.primitiveCalls.some(name => !Object.hasOwn(PRIMITIVES, name))) return false;
  }
  return true;
}

module.exports = { PRIMITIVES, evaluatePrimitive, buildBedrockPrimitivePlan, validatePrimitiveCoverage };
