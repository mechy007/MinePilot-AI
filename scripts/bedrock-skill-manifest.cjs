'use strict';

const { BedrockOpenWorldLearningEngine } = require('./bedrock-open-world-skills.cjs');

/**
 * Capability catalog for MinePilot's Bedrock runtime. A capability advertised
 * here NEVER grants raw packet access or permission to execute it.
 */
const TYPES=Object.freeze([
  'observe_world','world_memory','recognize_hostiles','explore',
  'follow_player','return_home','collect_observed_drops','auto_respawn',
  'mine','eat_food','attack_hostile','craft','build_shelter'
]);

const CURRICULUM=Object.freeze([
  {id:'observe_world',goal:'survive',title:'Learn the current world state',requires:['observe_world'],priority:100},
  {id:'safe_navigation',goal:'explore',title:'Practice verified local navigation',requires:['explore'],priority:110},
  {id:'player_escort',goal:'follow',title:'Practice following a visible player',requires:['follow_player'],priority:70},
  {id:'home_return',goal:'return_home',title:'Practice returning to a marked home',requires:['return_home'],priority:65},
  {id:'resource_collection',goal:'gather',title:'Practice collecting observed drops',requires:['collect_observed_drops'],priority:50}
]);

function one(state,reason){return {state,reason};}

function evaluateCapabilities(world) {
  const ready=Boolean(world && !world.closed && world.spawned &&
    world.position && world.dimension!==null);
  const terrain=world?.terrain?.snapshot?.()??{};
  const navigate=ready&&terrain.collisionClassificationReady===true &&
    world?.movement?.capability?.(world)==='experimental' &&
    world?.lastServerPositionAt!=null &&
    Number.isFinite(world?.clock?.()-world.lastServerPositionAt) &&
    world.clock()-world.lastServerPositionAt>=0 &&
    world.clock()-world.lastServerPositionAt<=7000 &&
    [1,2].includes(world?.movementAuthority);
  const layer2=ready?world?.layerTwo?.snapshot?.(world.gameplayWorld()):null;
  const resources=ready?world?.layerThree?.snapshot?.(world.gameplayWorld()):null;
  const life=world?.lifeSenses!=null;
  const result={
    observe_world:ready?one('ready','server_observations') : one('blocked','world_not_ready'),
    world_memory:ready&&world?.intelligence?
      one('ready','session_local_bounded_memory'):one('blocked','world_or_intelligence_unavailable'),
    recognize_hostiles:ready&&life?
      one('partial','only_recognized_entity_types'):one('blocked','perception_unavailable'),
    explore:navigate?one('experimental','verified_local_terrain_only'):
      one('blocked','movement_or_terrain_unavailable'),
    follow_player:navigate&&layer2?.preview?.goal==='follow'?
      one('experimental','selected_player_target_only'):
      one('blocked','select_player_and_verify_terrain'),
    return_home:navigate&&layer2?.homeKnown===true?
      one('experimental','marked_home_same_dimension'):
      one('blocked','mark_home_and_verify_terrain'),
    collect_observed_drops:navigate&&resources?.inventoryKnown&&
      (resources?.nearbyItemNames?.length??0)>0?
      one('experimental','server_observed_drops_only'):
      one('blocked','requires_observed_drop_and_inventory'),
    auto_respawn:ready&&world?.respawnRecovery?
      one('protocol_only','device_host_respawn_unverified'):
      one('blocked','world_or_respawn_unavailable'),
    mine:one('manual_experimental','single_block_action_needs_user_confirmation'),
    eat_food:one('unsupported','needs_item_use_transaction_and_host_ack'),
    attack_hostile:one('unsupported','needs_attack_transaction_and_host_ack'),
    craft:one('unsupported','needs_recipe_container_stack_validation'),
    build_shelter:one('preview_only','no_verified_block_placement_executor')
  };
  return {
    version:'minepilot.gameplay.skills.v1',
    worldReady:ready,localNavigationReady:navigate,
    userConfirmationRequired:true,rawPacketAccess:false,
    permittedGoalNames:['survive','explore','follow','return_home','gather'],
    skills:TYPES.map(name=>({name,...result[name]}))
  };
}

const engines = new WeakMap();

function learningEngineFor(world) {
  if (!world || typeof world !== 'object') return null;
  let engine = engines.get(world);
  if (!engine) {
    const storagePath = typeof world.commandPath === 'string'
      ? world.commandPath + '.voyager-learning.json' : null;
    engine = new BedrockOpenWorldLearningEngine({ storagePath, clock: world.clock ?? Date.now });
    engines.set(world, engine);
  }
  return engine;
}

function gameplaySkillManifest(world) {
  const manifest = evaluateCapabilities(world);
  const engine = learningEngineFor(world);
  return {
    ...manifest,
    learning: engine ? engine.observe(world, manifest) : {
      version: 'minepilot.voyager-odyssey.v1',
      mode: 'unavailable',
      nextCurriculumTask: null,
      arbitraryCodeExecution: false
    },
    openWorldSkills: engine ? engine.catalog() : {
      version: 'minepilot.voyager-odyssey.v1',
      primitives: [],
      compositions: []
    }
  };
}

function startLearningTask(world, taskId, options = {}) {
  const engine = learningEngineFor(world);
  if (!engine) return { status: 'rejected', reason: 'learning_engine_unavailable' };
  return engine.start(world, evaluateCapabilities(world), taskId, options);
}

function stopLearningTask(world, reason) {
  const engine = learningEngineFor(world);
  if (!engine) return { status: 'rejected', reason: 'learning_engine_unavailable' };
  return engine.stop(world, reason);
}

function proposeLearningSkill(world, proposal) {
  const engine = learningEngineFor(world);
  if (!engine) return { status: 'rejected', reason: 'learning_engine_unavailable' };
  return engine.propose(proposal);
}

module.exports = {
  gameplaySkillManifest,
  evaluateCapabilities,
  learningEngineFor,
  startLearningTask,
  stopLearningTask,
  proposeLearningSkill
};
