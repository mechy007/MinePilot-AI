'use strict';

const { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

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

function safeSkillRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.id !== 'string' || !/^[a-z][a-z0-9_]{1,47}$/.test(value.id)) return null;
  if (typeof value.title !== 'string' || value.title.length>100) return null;
  if (typeof value.goal !== 'string' || !['survive','explore','follow','return_home','gather'].includes(value.goal)) return null;
  if (value.status !== 'verified' || !Number.isInteger(value.verifiedRuns) || value.verifiedRuns<1 || value.verifiedRuns>100000) return null;
  if (!Array.isArray(value.steps) || value.steps.length>16 ||
      !value.steps.every(step=>typeof step==='string' && /^[a-z][a-z0-9_]{1,47}$/.test(step))) return null;
  // Only declarative, allow-listed action identifiers are stored. Never persist
  // or evaluate model-generated JavaScript, shell commands, or raw packets.
  const allowed=new Set(['observe_world','plan_local_route','request_bounded_step','verify_server_position','stop_on_hazard']);
  if (!value.steps.every(step=>allowed.has(step))) return null;
  return {id:value.id,title:value.title,goal:value.goal,status:'verified',
    verifiedRuns:value.verifiedRuns,steps:[...value.steps],updatedAt:Number.isFinite(value.updatedAt)?value.updatedAt:0};
}

class VoyagerLearningCore {
  constructor(options={}) {
    this.clock=options.clock??Date.now;
    this.storagePath=typeof options.storagePath==='string'&&options.storagePath.length<1024
      ?options.storagePath:null;
    this.skills=new Map();
    this.observedVerifiedSteps=0;
    this.totalVerifiedSteps=0;
    this.lastGoal='none';
    this.lastPersistError=null;
    this.load();
  }
  load() {
    if(!this.storagePath||!existsSync(this.storagePath))return;
    try {
      const raw=JSON.parse(readFileSync(this.storagePath,'utf8'));
      if(raw?.version!=='minepilot.voyager-learning.v1'||
         !Array.isArray(raw.skills)||raw.skills.length>128)return;
      for(const item of raw.skills.slice(0,128)){
        const skill=safeSkillRecord(item);
        if(skill)this.skills.set(skill.id,skill);
      }
      this.totalVerifiedSteps=Number.isSafeInteger(raw.totalVerifiedSteps)&&raw.totalVerifiedSteps>=0
        ?Math.min(raw.totalVerifiedSteps,10000000):0;
    } catch { this.lastPersistError='skill_store_unreadable'; }
  }
  persist() {
    if(!this.storagePath)return false;
    const temp=this.storagePath+'.'+randomUUID()+'.tmp';
    try {
      mkdirSync(path.dirname(this.storagePath),{recursive:true});
      const payload={version:'minepilot.voyager-learning.v1',
        totalVerifiedSteps:this.totalVerifiedSteps,
        skills:[...this.skills.values()].slice(0,128)};
      writeFileSync(temp,JSON.stringify(payload),{flag:'wx',mode:0o600});
      renameSync(temp,this.storagePath);
      this.lastPersistError=null;
      return true;
    } catch {
      try{unlinkSync(temp);}catch{}
      this.lastPersistError='skill_store_write_failed';
      return false;
    }
  }
  observe(world) {
    const agent=world?.gameplayAgent?.snapshot?.()??{};
    const autonomy=world?.autonomy?.snapshot?.()??{};
    const verified=Math.max(0,
      Number.isInteger(agent.serverVerifiedSteps)?agent.serverVerifiedSteps:0,
      Number.isInteger(autonomy.serverVerifiedSteps)?autonomy.serverVerifiedSteps:0);
    if(verified>this.observedVerifiedSteps){
      this.totalVerifiedSteps+=Math.min(verified-this.observedVerifiedSteps,1000);
      this.observedVerifiedSteps=verified;
      this.persist();
    } else if(verified<this.observedVerifiedSteps) {
      // A new world/session resets session counters. Keep the persistent total.
      this.observedVerifiedSteps=verified;
    }
    const goal=world?.intelligence?.snapshot?.()?.goal;
    if(typeof goal==='string')this.lastGoal=goal;
    return this.snapshot(world);
  }
  snapshot(world=null) {
    const manifest=world?evaluateCapabilities(world):null;
    const available=new Set(manifest?.skills?.filter(s=>['ready','experimental','partial'].includes(s.state)).map(s=>s.name)??[]);
    const next=CURRICULUM.filter(item=>item.goal!==this.lastGoal &&
      item.requires.every(skill=>available.has(skill)) &&
      !this.skills.has(item.id)).sort((a,b)=>b.priority-a.priority)[0]??null;
    return {
      version:'minepilot.voyager-learning.v1',
      mode:'curriculum_and_declarative_skill_memory',
      skillCount:this.skills.size,
      skills:[...this.skills.values()].map(s=>({...s,steps:[...s.steps]})),
      totalVerifiedNavigationSteps:this.totalVerifiedSteps,
      currentGoal:this.lastGoal,
      nextCurriculumTask:next?{id:next.id,goal:next.goal,title:next.title,priority:next.priority}:null,
      skillGeneration:'disabled_until_sandboxed_skill_validation_exists',
      arbitraryCodeExecution:false,
      persistence:this.storagePath?(this.lastPersistError?'error':'enabled'):'session_only',
      persistenceError:this.lastPersistError
    };
  }
  promoteVerifiedSkill(record) {
    const skill=safeSkillRecord(record);
    if(!skill)return {status:'rejected',reason:'skill_record_not_allowlisted_or_verified'};
    const prior=this.skills.get(skill.id);
    if(prior&&skill.verifiedRuns<prior.verifiedRuns)
      return {status:'rejected',reason:'verified_run_count_cannot_decrease'};
    this.skills.set(skill.id,skill);
    this.persist();
    return {status:'accepted',reason:'declarative_skill_record_saved'};
  }
}

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

const cores=new WeakMap();
function gameplaySkillManifest(world) {
  let core=null;
  if(world&&typeof world==='object'){
    core=cores.get(world);
    if(!core){
      const storagePath=typeof world.commandPath==='string'
        ?world.commandPath+'.voyager-learning.json':null;
      core=new VoyagerLearningCore({storagePath});
      cores.set(world,core);
    }
  }
  const manifest=evaluateCapabilities(world);
  return {...manifest,learning:core?core.observe(world):{
    version:'minepilot.voyager-learning.v1',mode:'unavailable',
    skillCount:0,nextCurriculumTask:null,arbitraryCodeExecution:false
  }};
}

module.exports={gameplaySkillManifest,evaluateCapabilities,VoyagerLearningCore,safeSkillRecord};
