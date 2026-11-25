'use strict';

// MinePilot-owned skill catalogue for Minecraft Bedrock Edition.
// This module deliberately contains no Java Edition, Mineflayer or Fabric
// execution assumptions. A skill is startable only when its Bedrock runtime
// prerequisites are currently observable and its existing actor can execute it.

const VERSION = 'minepilot.bedrock-skills.v1';

const DEFINITIONS = Object.freeze([
  { id: 'inspect_world', title: 'Inspect world', family: 'observation',
    description: 'Read the authenticated Bedrock session, player position, dimension and decoded nearby terrain.',
    mode: 'read_only', taskId: null },
  { id: 'inspect_inventory', title: 'Inspect inventory', family: 'observation',
    description: 'Read the latest server-observed Bedrock inventory and hotbar snapshot.',
    mode: 'read_only', taskId: null },
  { id: 'safe_exploration', title: 'Explore safely', family: 'navigation',
    description: 'Explore only collision-classified terrain with bounded movement and fresh server-position verification.',
    mode: 'bounded_agent', taskId: 'safe_exploration', requires: ['explore'] },
  { id: 'survival_patrol', title: 'Survival patrol', family: 'survival',
    description: 'Observe threats and survival state, then use the existing bounded survival/navigation agent.',
    mode: 'bounded_agent', taskId: 'survival_patrol', requires: ['explore'] },
  { id: 'follow_player', title: 'Follow selected player', family: 'navigation',
    description: 'Follow a player already selected in the Bedrock player-observation layer.',
    mode: 'bounded_agent', taskId: 'escort_selected_player', requires: ['follow_player'] },
  { id: 'return_home', title: 'Return home', family: 'navigation',
    description: 'Return to a marked home in the same Bedrock dimension using verified terrain.',
    mode: 'bounded_agent', taskId: 'return_home', requires: ['return_home'] },
  { id: 'retrieve_observed_drop', title: 'Retrieve observed drop', family: 'gathering',
    description: 'Approach a server-observed item drop and require a server-confirmed inventory increase.',
    mode: 'bounded_agent', taskId: 'retrieve_selected_drop', requires: ['collect_observed_drops'] },
  { id: 'select_hotbar_tool', title: 'Select hotbar tool', family: 'inventory',
    description: 'Select an already-observed tool from the Bedrock hotbar and wait for server equipment confirmation.',
    mode: 'manual_experimental', taskId: null, requires: ['hotbar_selection'] },
  { id: 'mine_single_block', title: 'Mine one block', family: 'gathering',
    description: 'Experimental single-block break only; requires explicit user confirmation and server-side block-change evidence.',
    mode: 'manual_experimental', taskId: null, requires: ['mine'] }
]);

const ROADMAP = Object.freeze([
  { id: 'craft_items', family: 'crafting', status: 'unsupported', reason: 'Bedrock recipe and inventory transaction executor not implemented' },
  { id: 'eat_food', family: 'survival', status: 'unsupported', reason: 'Bedrock item-use transaction and host acknowledgement not implemented' },
  { id: 'combat', family: 'combat', status: 'unsupported', reason: 'Bedrock attack action and authoritative hit verification not implemented' },
  { id: 'place_blocks', family: 'building', status: 'unsupported', reason: 'Bedrock block-placement transaction and world-change verification not implemented' },
  { id: 'farming', family: 'farming', status: 'unsupported', reason: 'Bedrock tilling, planting and crop-growth action chain not implemented' },
  { id: 'smelt_cook', family: 'crafting', status: 'unsupported', reason: 'Bedrock container and furnace transactions not implemented' },
  { id: 'animal_interaction', family: 'gathering', status: 'unsupported', reason: 'Bedrock entity interaction and inventory-result verification not implemented' },
  { id: 'fishing', family: 'gathering', status: 'unsupported', reason: 'Bedrock rod-use and catch verification not implemented' },
  { id: 'redstone', family: 'building', status: 'unsupported', reason: 'No Bedrock redstone interaction planner or verifier' }
]);

function capability(manifest, name) {
  return manifest?.skills?.find(item => item.name === name) ?? { state: 'blocked', reason: 'capability_not_reported' };
}

function freshness(observedAt, now, ttl) {
  return Number.isFinite(observedAt) && Number.isFinite(now) &&
    now - observedAt >= 0 && now - observedAt <= ttl;
}

function evaluateBedrockSkill(definition, world, manifest) {
  if (!world || world.closed || !manifest?.worldReady) {
    return { status: 'blocked', reason: 'authenticated_bedrock_world_required', canStart: false };
  }
  if (definition.id === 'inspect_world') {
    return { status: 'ready', reason: 'authenticated_bedrock_world_snapshot_available', canStart: true };
  }
  if (definition.id === 'inspect_inventory') {
    const inventory = world.inventoryLedger?.playerInventory?.() ??
      world.layerThree?.inventoryItems?.() ?? null;
    const now = typeof world.clock === 'function' ? world.clock() : Date.now();
    const valid = inventory?.known === true && inventory?.fresh === true &&
      inventory?.registryKnown === true && inventory?.unresolvedItemCount === 0;
    return valid
      ? { status: 'ready', reason: 'fresh_server_authoritative_inventory', canStart: true }
      : { status: 'blocked', reason: 'fresh_resolved_server_inventory_required', canStart: false };
  }

  const required = (definition.requires ?? []).map(name => ({
    name, ...(name === 'explore' ? { state: manifest.localNavigationReady ? 'experimental' : 'blocked',
      reason: manifest.localNavigationReady ? 'bounded_server_verified_navigation' : 'verified_navigation_unavailable' }
      : capability(manifest, name))
  }));
  const blocked = required.find(item => !['ready', 'experimental', 'partial', 'manual_experimental'].includes(item.state));
  if (blocked) return { status: 'blocked', reason: blocked.reason ?? 'bedrock_capability_unavailable', canStart: false };

  if (definition.mode === 'manual_experimental') {
    return { status: 'manual_experimental', reason: 'explicit_user_confirmation_and_server_verification_required',
      canStart: true, confirmationRequired: true };
  }
  if (!world.lifeSenses || !world.intelligence) {
    return { status: 'blocked', reason: 'perception_or_intelligence_unavailable', canStart: false };
  }
  return { status: 'experimental', reason: 'existing_bedrock_agent_with_bounded_server_verified_execution',
    canStart: true, confirmationRequired: true };
}

function bedrockNativeSkillCatalog(world, manifest) {
  const now = typeof world?.clock === 'function' ? world.clock() : Date.now();
  const skills = DEFINITIONS.map(definition => {
    const evaluated = evaluateBedrockSkill(definition, world, manifest);
    return { ...definition, ...evaluated, edition: 'bedrock' };
  });
  const counts = { ready: 0, experimental: 0, manual_experimental: 0, blocked: 0 };
  for (const skill of skills) counts[skill.status] = (counts[skill.status] ?? 0) + 1;
  return {
    version: VERSION,
    edition: 'minecraft_bedrock',
    source: 'minepilot_native',
    total: skills.length,
    executable: skills.filter(skill => skill.canStart && skill.mode !== 'read_only').length,
    readOnly: skills.filter(skill => skill.mode === 'read_only' && skill.canStart).length,
    counts,
    skills,
    roadmap: ROADMAP.map(item => ({ ...item })),
    policy: {
      javaEditionRuntime: false,
      mineflayerRuntime: false,
      arbitraryCodeExecution: false,
      requireFreshServerEvidence: true,
      requireUserConfirmationForActions: true,
      unsupportedSkillsCanExecute: false
    }
  };
}

function startBedrockNativeSkill(world, manifest, engine, skillId, options = {}) {
  const definition = DEFINITIONS.find(item => item.id === skillId);
  if (!definition) return { status: 'rejected', reason: 'unknown_bedrock_native_skill' };
  if (definition.mode === 'read_only')
    return { status: 'rejected', reason: 'read_only_skill_does_not_start_gameplay_task' };
  const evaluated = evaluateBedrockSkill(definition, world, manifest);
  if (!evaluated.canStart) return { status: 'rejected', reason: evaluated.reason };
  if (options.confirmed !== true)
    return { status: 'rejected', reason: 'confirmation_required' };
  if (definition.mode === 'manual_experimental')
    return { status: 'rejected', reason: 'manual_experimental_executor_requires_dedicated_action_path' };
  if (!engine || typeof engine.start !== 'function')
    return { status: 'rejected', reason: 'bedrock_learning_engine_unavailable' };
  return engine.start(world, manifest, definition.taskId, { confirmed: true });
}

module.exports = {
  VERSION, DEFINITIONS, ROADMAP, bedrockNativeSkillCatalog,
  evaluateBedrockSkill, startBedrockNativeSkill
};
