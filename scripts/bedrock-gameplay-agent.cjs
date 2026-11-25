'use strict';

/**
 * Bedrock Gameplay Agent V1
 * The only automated locomotion path is the existing experimental player
 * input writer. Every step requires explicitly classified collision-safe
 * voxels and a later, fresh SERVER position update showing progress.
 *
 * Goals: explore verified terrain, follow named player, return home, approach
 * observed dropped items. Survival: retreat from recognized hostiles when a
 * verified safe route exists; otherwise stop and report why. No automatic
 * combat, hunger packets, crafting, mining, building or teleportation.
 *
 * There is no implicit enable: users confirm each session in the Android UI.
 * The loop has strict budgets and can be cancelled synchronously.
 */
const {tileIsSafe}=require('./bedrock-local-path.cjs');
const INTERVAL_MS=250;
const MAX_RUN_MS=120000;
const MAX_STEPS=40;
const MAX_FAILURES=2;
const ACK_MS=4500;
const POSITION_TTL_MS=7000;
const MIN_PROGRESS=0.08;
const GOALS=new Set(['survive','explore','follow','return_home','gather','goto']);
const GOAL_DIRECTIVES=Object.freeze({
  survive:'survive_world', explore:'explore', follow:'follow_player',
  return_home:'return_home', gather:'gather_resources', goto:'go_to_position'
});
const FOOD_ITEMS=new Set(['minecraft:apple','minecraft:bread','minecraft:carrot',
  'minecraft:potato','minecraft:baked_potato','minecraft:cooked_beef',
  'minecraft:cooked_porkchop','minecraft:cooked_chicken','minecraft:cooked_mutton',
  'minecraft:golden_carrot','minecraft:melon_slice','minecraft:cooked_salmon']);
const CARDINAL=[[1,0],[0,1],[-1,0],[0,-1]];
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const finite=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<=30000000);
const copy=p=>({x:p.x,y:p.y,z:p.z});

class BedrockGameplayAgent {
  constructor(options={}) {
    this.clock=options.clock??Date.now;
    this.setInterval=options.setInterval??setInterval;
    this.clearInterval=options.clearInterval??clearInterval;
    this.interval=null;
    this.active=false;
    this.world=null;
    this.goal='none';
    this.phase='idle';
    this.reason='not_enabled';
    this.startedAt=null;
    this.dimension=null;
    this.attempted=0;
    this.verified=0;
    this.failures=0;
    this.awaiting=null;
    this.lastVerifiedAt=null;
    this.lastPlan=null;
    this.recentCells=new Map();
    this.nextActionAt=0;
    this.subgoal=null;
    this.targetPosition=null;
    this.collected=0;
    this.ignoredDrops=new Map();
    this.lastIntelligenceDirective=null;
  }
  readiness(world) {
    if(!world||world.closed||!world.spawned||!finite(world.position) ||
       ![0,1,2].includes(world.dimension)||world.respawnRecovery?.state!=='alive')
      return 'world_or_respawn_not_ready';
    if(![1,2].includes(world.movementAuthority) ||
       typeof world.serverTick!=='bigint')
      return 'authoritative_movement_unavailable';
    const positionUsable = typeof world.positionUsable === 'function'
      ? world.positionUsable()
      : world.lastServerPositionAt!=null &&
        this.clock()-world.lastServerPositionAt>=0 &&
        this.clock()-world.lastServerPositionAt<=POSITION_TTL_MS;
    const pendingOwnAck=this.active && this.world===world && this.awaiting &&
      world.movement?.snapshot?.()?.unconfirmedMovement===true &&
      this.clock()-this.awaiting.startedAt>=0 &&
      this.clock()-this.awaiting.startedAt<=ACK_MS+1800;
    if(!positionUsable&&!pendingOwnAck)return 'server_position_stale';
    if(!world.terrain?.snapshot?.().collisionClassificationReady ||
       typeof world.terrain.tile!=='function' ||
       typeof world.routePlanner!=='function')
      return 'verified_terrain_unavailable';
    if(world.movement?.capability?.(world)!=='experimental')
      return 'experimental_movement_not_enabled';
    if(world.blockBreaker?.snapshot?.()?.active)
      return 'block_break_busy';
    return null;
  }
  start(world,opts={}) {
    if(this.active)return {status:'rejected',reason:'gameplay_agent_already_active'};
    if(opts.confirmed!==true)return {status:'rejected',reason:'confirmation_required'};
    if(!GOALS.has(opts.goal))return {status:'rejected',reason:'unsupported_goal'};
    if(world?.autonomy?.snapshot?.()?.active)return {status:'rejected',reason:'follow_autonomy_busy'};
    const blocker=this.readiness(world);
    if(blocker)return {status:'rejected',reason:blocker};
    if(!world.lifeSenses||!world.intelligence)
      return {status:'rejected',reason:'perception_or_intelligence_unavailable'};
    let select;
    if(opts.goal==='follow') {
      if(opts.playerName) {
        select=world.layerTwo?.follow(opts.playerName,world.gameplayWorld());
        if(select?.status!=='accepted')
          return select??{status:'rejected',reason:'follow_plan_unavailable'};
      }
      const preview=world.layerTwo?.preview(world.gameplayWorld());
      if(preview?.goal!=='follow')return {status:'rejected',reason:'select_follow_player_first'};
    } else if(opts.goal==='return_home') {
      select=world.layerTwo?.returnHome(world.gameplayWorld());
      if(select?.status!=='accepted')
        return select??{status:'rejected',reason:'home_not_marked'};
    } else if(opts.goal==='goto') {
      if(!finite(opts.targetPosition) ||
         distance(world.position,opts.targetPosition)>16)
        return {status:'rejected',reason:'goto_target_must_be_within_16_blocks'};
      const route=world.routePlanner(world.terrain,world.dimension,world.position,
        opts.targetPosition,{radius:16});
      if(route?.status!=='route_found'||!finite(route.waypoint)||
         !Array.isArray(route.path)||route.path.length<2)
        return {status:'rejected',reason:route?.reason??'goto_route_not_verified'};
    } else if(opts.goal==='gather') {
      const preview=world.layerThree?.preview(world.gameplayWorld());
      if(!preview||preview.status==='idle'||!preview.itemName)
        return {status:'rejected',reason:'select_observed_item_goal_first'};
    }
    this.world=world;
    this.active=true;
    this.goal=opts.goal;
    this.phase='observing';
    this.reason='goal_accepted_awaiting_verified_terrain';
    this.startedAt=this.clock();
    this.dimension=world.dimension;
    this.attempted=0;this.verified=0;this.failures=0;
    this.awaiting=null;this.lastVerifiedAt=null;this.lastPlan=null;
    this.nextActionAt=0;this.recentCells.clear();
    this.subgoal=null;this.targetPosition=opts.goal==='goto'?copy(opts.targetPosition):null;this.collected=0;this.ignoredDrops.clear();
    this.lastIntelligenceDirective=null;
    world.intelligence.setGoal(opts.goal);
    this.interval=this.setInterval(()=>this.pulse(),INTERVAL_MS);
    return {status:'accepted',reason:'gameplay_agent_enabled_not_yet_moving'};
  }
  stop(reason='user_stopped') {
    if(this.interval!==null)this.clearInterval(this.interval);
    this.interval=null;
    const world=this.world;
    const wasActive=this.active;
    this.active=false;this.world=null;this.awaiting=null;
    this.phase='idle';this.reason=reason;this.nextActionAt=0;
    if(wasActive&&this.subgoal&&world?.layerThree?.cancel)
      world.layerThree.cancel();
    this.subgoal=null;this.targetPosition=null;
    if(wasActive&&world?.movement?.snapshot?.()?.active)
      world.movement.stop('gameplay_agent_stopped');
    if(wasActive&&world?.intelligence)world.intelligence.setGoal('standby');
    return {status:'ok',reason};
  }
  pause(reason) {
    this.phase='paused';
    this.reason=reason;
    this.lastPlan=null;
  }
  pauseForIntelligence(reason) {
    const world=this.world;
    if(world?.movement?.snapshot?.()?.active)
      world.movement.stop?.('intelligence_'+reason);
    // A planner veto invalidates an outstanding movement attempt; it is not a
    // failed server acknowledgement and must never be counted as progress.
    this.awaiting=null;
    this.pause(reason);
  }
  noteFailure(reason) {
    this.failures++;
    this.world?.intelligence?.noteOutcome('failed');
    this.reason=reason;
    this.awaiting=null;
    this.nextActionAt=this.clock()+1000;
    // Once non-neutral input has been sent, a missing server update leaves
    // the prior position unusable. Never retry movement from that stale anchor.
    if(this.world?.movement?.snapshot?.()?.unconfirmedMovement===true ||
       this.failures>=MAX_FAILURES) {
      this.stop(reason);return;
    }
    this.phase='recovering';
  }
  recordCell(position) {
    const key=[Math.floor(position.x),Math.floor(position.z)].join(',');
    this.recentCells.set(key,(this.recentCells.get(key)??0)+1);
    if(this.recentCells.size>96)
      this.recentCells.delete(this.recentCells.keys().next().value);
  }
  localTarget(world,threat=null) {
    const position=world.position,dim=world.dimension;
    // The y convention matches the existing local A* implementation.
    const y=Math.floor(position.y-1.62+0.01);
    const px=Math.floor(position.x),pz=Math.floor(position.z);
    const targets=[];
    for(let radius=1;radius<=3;radius++) {
      for(const [dx,dz] of CARDINAL) {
        const x=px+dx*radius,z=pz+dz*radius;
        if(!tileIsSafe(world.terrain,dim,x,y,z))continue;
        const target={x:x+0.5,y:position.y,z:z+0.5};
        const plan=world.routePlanner(world.terrain,dim,position,target,{
          radius:Math.max(3,radius+1)
        });
        if(plan?.status!=='route_found'||!finite(plan.waypoint)||
           plan.path?.length<2)continue;
        if(threat){
          const distNow=Math.hypot(position.x-threat.position.x,
            position.z-threat.position.z);
          const distAfter=Math.hypot(target.x-threat.position.x,
            target.z-threat.position.z);
          if(distAfter-distNow<0.7)continue;
          targets.push({target,plan,score:distAfter*10-radius});
        }else{
          const visits=this.recentCells.get([x,z].join(','))??0;
          targets.push({target,plan,score:radius*3-visits*25});
        }
      }
    }
    targets.sort((a,b)=>b.score-a.score);
    return targets[0]?.plan?.waypoint??null;
  }
  ignoreDrop(name) {
    this.ignoredDrops.delete(name);
    this.ignoredDrops.set(name,this.clock()+30000);
    while(this.ignoredDrops.size>32)
      this.ignoredDrops.delete(this.ignoredDrops.keys().next().value);
  }
  opportunisticDrop(world,foodOnly=false) {
    if(!world.layerThree?.snapshot || !world.layerThree?.planCollect)return false;
    const data=world.layerThree.snapshot(world.gameplayWorld());
    if(!data?.inventoryKnown||!Array.isArray(data.nearbyItemNames))return false;
    const now=this.clock();
    for(const name of data.nearbyItemNames.slice(0,12)) {
      if(typeof name!=='string'||!/^minecraft:[a-z0-9_./-]{1,80}$/.test(name))
        continue;
      if(foodOnly&&!FOOD_ITEMS.has(name))continue;
      if((this.ignoredDrops.get(name)??0)>now)continue;
      const result=world.layerThree.planCollect(name,1,world.gameplayWorld());
      if(result?.status!=='accepted')continue;
      this.subgoal={kind:'pickup',item:name,startedAt:now};
      return true;
    }
    return false;
  }
  survivalGoal(world) {
    const now=this.clock();
    const hunger=world.lifeSenses?.snapshot?.({
      position:world.position,dimension:world.dimension,spawned:world.spawned,
      closed:world.closed,respawnState:world.respawnRecovery.state,
      terrain:world.terrain
    })?.hunger;
    const needsFood=hunger!==null&&hunger!==undefined&&hunger<=6;
    if(this.subgoal) {
      const progress=world.layerThree?.preview?.(world.gameplayWorld());
      if(progress?.status==='observed_inventory_increase') {
        this.collected++;
        world.layerThree?.cancel?.();
        this.ignoreDrop(this.subgoal.item);
        this.subgoal=null;
        this.nextActionAt=now+500;
      }else if(now-this.subgoal.startedAt>10000) {
        // A disappearing drop without an inventory delta is not a confirmed
        // pickup. Don't loop forever attempting to collect it.
        this.ignoreDrop(this.subgoal.item);
        world.layerThree?.cancel?.();
        this.subgoal=null;
      }else if(progress?.status==='route_unverified' && finite(progress.nextPoint)) {
        const nav=world.routePlanner(world.terrain,world.dimension,
          world.position,progress.nextPoint);
        if(nav?.status==='route_found'&&finite(nav.waypoint))
          return {status:'ready',waypoint:nav.waypoint,reason:'observed_drop_path_verified'};
        return {status:'paused',reason:nav?.reason??'drop_route_unverified'};
      }else{
        return {status:'paused',reason:progress?.status==='within_range'?
          'await_server_pickup_and_inventory_delta':
          'await_updated_drop_or_inventory'};
      }
    }
    if(!this.subgoal) {
      const picked=this.opportunisticDrop(world,needsFood);
      if(picked)return this.survivalGoal(world);
    }
    if(needsFood){
      world.layerFour?.planFood?.();
      return {status:'paused',reason:'food_needed_no_verified_item_use'};
    }
    const waypoint=this.localTarget(world);
    return waypoint?{status:'ready',waypoint,reason:'survival_explore_safe_ground'}:
      {status:'paused',reason:'survival_no_verified_path'};
  }

  targetFromGoal(world) {
    if(this.goal==='survive')return this.survivalGoal(world);
    const state=world.gameplayWorld();
    if(this.goal==='goto') {
      if(!finite(this.targetPosition))
        return {status:'paused',reason:'goto_target_missing'};
      if(distance(world.position,this.targetPosition)<=0.8)
        return {status:'complete',reason:'server_position_reached_goto_target'};
      const route=world.routePlanner(world.terrain,world.dimension,world.position,
        this.targetPosition,{radius:16});
      return route?.status==='route_found'&&finite(route.waypoint)&&
        Array.isArray(route.path)&&route.path.length>=2
        ? {status:'ready',waypoint:route.waypoint,reason:'bounded_goto_route_verified'}
        : {status:'paused',reason:route?.reason??'goto_route_not_verified'};
    }
    if(this.goal==='explore') {
      const waypoint=this.localTarget(world);
      return waypoint?{status:'ready',waypoint,reason:'known_walkable_exploration'}:
        {status:'paused',reason:'no_safe_exploration_route'};
    }
    if(this.goal==='follow'||this.goal==='return_home') {
      const plan=world.layerTwo?.preview(state);
      if(!plan || plan.goal!==(this.goal==='follow'?'follow':'return'))
        return {status:'paused',reason:'navigation_goal_unavailable'};
      if(plan.status==='at_target')
        return {status:'complete',reason:'target_reached'};
      if(plan.status!=='route_unverified'||!finite(plan.nextPoint))
        return {status:'paused',reason:plan.reason??'target_not_visible'};
      const path=world.routePlanner(world.terrain,world.dimension,world.position,plan.nextPoint);
      return path?.status==='route_found'&&finite(path.waypoint)?
        {status:'ready',waypoint:path.waypoint,reason:'verified_follow_or_return_route'}:
        {status:'paused',reason:path?.reason??'path_not_verified'};
    }
    if(this.goal==='gather') {
      const drop=world.layerThree?.preview(state);
      if(drop?.status==='observed_inventory_increase')
        return {status:'complete',reason:'server_confirmed_item_pickup'};
      if(drop?.status==='within_range')
        return {status:'paused',reason:'awaiting_server_item_pickup'};
      if(drop?.status!=='route_unverified'||!finite(drop.nextPoint))
        return {status:'paused',reason:drop?.reason??'item_drop_unavailable'};
      const path=world.routePlanner(world.terrain,world.dimension,world.position,drop.nextPoint);
      return path?.status==='route_found'&&finite(path.waypoint)?
        {status:'ready',waypoint:path.waypoint,reason:'observed_drop_route_verified'}:
        {status:'paused',reason:path?.reason??'drop_route_not_verified'};
    }
    return {status:'paused',reason:'unsupported_goal'};
  }
  pulse() {
    if(!this.active)return;
    const world=this.world,now=this.clock();
    if(now-this.startedAt>MAX_RUN_MS||this.attempted>=MAX_STEPS) {
      this.stop('gameplay_run_budget_exhausted');return;
    }
    if(!world||world.dimension!==this.dimension) {
      this.stop('dimension_or_session_changed');return;
    }
    const blocker=this.readiness(world);
    if(blocker) {
      this.stop(blocker);return;
    }
    if(world.autonomy?.snapshot?.()?.active) {
      this.stop('follow_autonomy_started');return;
    }
    const life=world.lifeSenses.snapshot({
      position:world.position,dimension:world.dimension,spawned:world.spawned,
      closed:world.closed,respawnState:world.respawnRecovery.state,
      terrain:world.terrain
    });
    // The intelligence core is the high-level intent arbiter. The gameplay
    // agent remains the bounded executor and independently verifies every
    // route, movement pulse and server acknowledgement.
    const brain=world.intelligenceTick?.() ?? world.intelligence.snapshot?.();
    const pendingOwnAck=Boolean(this.awaiting &&
      world.movement?.snapshot?.()?.unconfirmedMovement===true &&
      now-this.awaiting.startedAt>=0 && now-this.awaiting.startedAt<=ACK_MS+1800);
    if(!brain || typeof brain.action!=='string') {
      this.pauseForIntelligence('intelligence_decision_unavailable');return;
    }
    this.lastIntelligenceDirective={
      action:brain.action,reason:typeof brain.reason==='string'?brain.reason:'unknown',
      confidence:Number.isFinite(brain.confidence)?brain.confidence:0
    };
    if(brain.action==='await_respawn') {
      this.stop('intelligence_awaiting_respawn');return;
    }
    const awaitingPositionOnly= pendingOwnAck && brain.action==='observe' &&
      brain.reason==='world_state_stale';
    if((brain.action==='observe' || brain.positionUsable===false || brain.positionMode==='stale') &&
       !awaitingPositionOnly) {
      this.pauseForIntelligence(brain.reason==='world_state_stale'
        ?'intelligence_world_state_stale':'intelligence_observation_only');return;
    }
    if(life.state==='dead'||life.health===0) {
      this.stop('player_died');return;
    }
    if(life.health===null||life.health===undefined) {
      this.pauseForIntelligence('intelligence_health_unobserved');return;
    }
    const enemy=life.nearbyEntities?.find(e=>e.hostile===true &&
      Number.isFinite(e.distance)&&e.distance<=8 &&
      finite(e.position));
    const critical=life.health<=6 || (life.air!==null&&life.air<=4);
    const hunger=life.hunger!==null&&life.hunger<=6;
    const movement=world.movement;
    if(brain.action==='seek_safety') {
      if(!critical) {
        this.pauseForIntelligence('intelligence_safety_evidence_mismatch');return;
      }
      this.pauseForIntelligence('critical_vitals_wait_for_safe_recovery');return;
    }
    if(critical) {
      this.pauseForIntelligence('intelligence_safety_directive_missing');return;
    }
    if(brain.action==='avoid_threat') {
      if(!enemy) {
        this.pauseForIntelligence('intelligence_threat_evidence_mismatch');return;
      }
    } else if(enemy) {
      this.pauseForIntelligence('intelligence_threat_directive_missing');return;
    }
    if(brain.action==='find_food') {
      if(!hunger) {
        this.pauseForIntelligence('intelligence_food_evidence_mismatch');return;
      }
    } else if(hunger && !enemy) {
      this.pauseForIntelligence('intelligence_food_directive_missing');return;
    }
    if(!awaitingPositionOnly && brain.action!=='avoid_threat' && brain.action!=='find_food' &&
       brain.action!==GOAL_DIRECTIVES[this.goal]) {
      this.pauseForIntelligence('intelligence_goal_directive_mismatch');return;
    }
    // Inventory delta plus server pickup receipt is stronger evidence of
    // collecting an item than any movement acknowledgement. Treat it as an
    // independent completion, even if walking was still in progress.
    if(this.goal==='survive'&&this.subgoal &&
       world.layerThree?.preview?.(world.gameplayWorld())?.status===
         'observed_inventory_increase') {
      if(movement.snapshot?.()?.active)
        movement.stop?.('inventory_pickup_confirmed');
      this.collected++;
      this.ignoreDrop(this.subgoal.item);
      world.layerThree?.cancel?.();
      this.subgoal=null;
      this.awaiting=null;
      this.phase='verified';
      this.reason='server_confirmed_drop_pickup';
      this.nextActionAt=now+500;
      return;
    }
    // A newly recognized hostile takes priority over a pending walking
    // request. Stop that request; do NOT count it as confirmed or failed.
    // The next pulse may select a collision-checked retreat instead.
    if(enemy && this.awaiting && this.awaiting.kind!=='retreat') {
      movement.stop?.('threat_preempted_movement');
      this.awaiting=null;
      this.phase='evading';
      this.reason='hostile_preempted_navigation';
      this.nextActionAt=now+250;
      return;
    }
    if(this.awaiting) {
      const a=this.awaiting;
      if(movement.snapshot?.()?.active) {
        if(now-a.startedAt>ACK_MS+1800) {
          movement.stop?.('server_progress_timeout');
          this.noteFailure('server_movement_not_confirmed');
        }
        return;
      }
      const updated=world.lastServerPositionAt!=null &&
        world.lastServerPositionAt>a.observedAt;
      const moved=distance(world.position,a.from)>=MIN_PROGRESS;
      const toward=distance(a.from,a.target)-
        distance(world.position,a.target)>=0.05;
      if(updated&&moved&&toward&&world.corrections<=a.corrections) {
        this.verified++;
        this.failures=0;
        world.intelligence.noteOutcome('verified');
        this.recordCell(world.position);
        this.awaiting=null;
        this.phase='verified';
        this.reason='server_confirmed_waypoint_progress';
        this.lastVerifiedAt=now;
        this.nextActionAt=now+400;
      } else if(world.corrections>a.corrections) {
        this.noteFailure('server_correction_not_verified_progress');
      } else if(now-a.startedAt>ACK_MS) {
        this.noteFailure('server_movement_not_confirmed');
      } else {
        this.phase='awaiting_server_confirmation';
        this.reason='movement_sent_not_yet_verified';
      }
      return;
    }
    if(movement.snapshot?.()?.active) {
      this.pause('other_movement_active');return;
    }
    if(now<this.nextActionAt)return;
    let target=null,planReason='';
    if(enemy) {
      target=this.localTarget(world,enemy);
      if(!target) {this.pause('no_verified_retreat_from_hostile');return;}
      planReason='verified_retreat_from_hostile';
    }else if(critical) {
      // Standing still while critically injured is safer than selecting an
      // arbitrary direction. Only move on *observed* retreat routes.
      this.pause('critical_vitals_wait_for_safe_recovery');return;
    }else if(hunger && this.goal!=='survive') {
      world.layerFour?.planFood?.();
      this.pause('low_hunger_requires_verified_food_interaction');return;
    }else{
      const goal=this.targetFromGoal(world);
      if(goal.status==='complete') {
        this.stop(goal.reason);return;
      }
      if(goal.status!=='ready') {
        this.pause(goal.reason);return;
      }
      target=goal.waypoint;planReason=goal.reason;
    }
    if(!finite(target)) {this.pause('no_verified_next_waypoint');return;}
    // A final path check immediately before sending input: no stale terrain,
    // large drops, jumping or speculative collision assumptions.
    const path=world.routePlanner(world.terrain,world.dimension,world.position,target,{radius:3});
    if(path?.status!=='route_found'||!finite(path.waypoint)||
       path.path?.length<2) {
      this.pause('waypoint_no_longer_verified');return;
    }
    const from=copy(world.position);
    const result=movement.runVerifiedStep?.(world,path.waypoint,8);
    if(result?.status!=='accepted') {
      this.noteFailure(result?.reason??'movement_input_rejected');return;
    }
    this.attempted++;
    this.phase='moving';
    this.reason=planReason+'_awaiting_server';
    this.lastPlan={target:copy(path.waypoint),kind:enemy?'retreat':this.goal};
    this.awaiting={from,target:copy(path.waypoint),observedAt:world.lastServerPositionAt,
      corrections:world.corrections??0,startedAt:now,
      kind:enemy?'retreat':this.goal};
  }
  snapshot() {
    return {active:this.active,goal:this.goal,phase:this.phase,reason:this.reason,
      attemptedSteps:this.attempted,serverVerifiedSteps:this.verified,
      failures:this.failures,maxSteps:MAX_STEPS,runBudgetMs:MAX_RUN_MS,
      target:this.awaiting?{...this.awaiting.target}:null,
      lastPlan:this.lastPlan?{target:{...this.lastPlan.target},kind:this.lastPlan.kind}:null,
      execution:this.active?'experimental_verified_movement':'inactive',
      collectedDrops:this.collected,
      currentSubgoal:this.subgoal?{kind:this.subgoal.kind,item:this.subgoal.item}:null,
      targetPosition:this.targetPosition?{...this.targetPosition}:null,
      intelligenceDirective:this.lastIntelligenceDirective
        ?{...this.lastIntelligenceDirective}:null,
      autonomousCombat:false,autonomousMining:false,autonomousEating:false,
      serverVerified:this.verified>0};
  }
}
module.exports={BedrockGameplayAgent};
