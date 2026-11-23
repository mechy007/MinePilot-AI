'use strict';

/**
 * Experimental, finite autonomy loop for a standalone Xbox Bedrock player.
 * It executes actual (bounded) auth-input pulses on verified terrain, but NEVER
 * chains them without fresh server-confirmed progress. It also never attacks,
 * breaks or places blocks in this module.
 */
const TICK_MS=250;
const MAX_STEPS=20;
const MAX_RUN_MS=30000;
const ACK_MS=4000;
const MIN_PROGRESS=0.08;
function distance(a,b) {
  return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
}
class VerifiedAutonomyRunner {
  constructor(options={}) {
    this.clock=options.clock??Date.now;
    this.setInterval=options.setInterval??setInterval;
    this.clearInterval=options.clearInterval??clearInterval;
    this.interval=null;
    this.world=null;
    this.active=false;
    this.phase='idle';
    this.stepCount=0;
    this.lastReason='idle';
    this.startedAt=null;
    this.initialDimension=null;
    this.awaiting=null;
    this.verifiedSteps=0;
  }
  route(world) {
    const plan=world.layerTwo?.preview(world.gameplayWorld());
    if (!plan || !['follow','return'].includes(plan.goal))
      return {status:'rejected',reason:'no_selected_follow_or_return'};
    if(plan.status==='at_target')
      return {status:'complete',reason:'target_reached'};
    if(plan.status!=='route_unverified'||!plan.nextPoint)
      return {status:'rejected',reason:plan.reason??'route_not_ready'};
    if(!world.terrain || !world.routePlanner || !world.position)
      return {status:'rejected',reason:'terrain_decoder_unavailable'};
    const nav=world.routePlanner(world.terrain,world.dimension,world.position,plan.nextPoint);
    return nav?.status==='route_found' && nav.waypoint
      ? {status:'ready',waypoint:nav.waypoint,reason:nav.reason}
      : {status:'rejected',reason:nav?.reason??'unverified_terrain'};
  }
  safety(world) {
    if (!world || world.closed || !world.spawned || world.dimension==null ||
        !world.position || ![1,2].includes(world.movementAuthority))
      return 'world_not_ready';
    if (world.gameplayWorld().safetyHold) return 'survival_safety_override';
    if (!world.terrain?.snapshot().collisionClassificationReady)
      return 'block_registry_unavailable';
    if (world.movement?.capability(world)!=='experimental')
      return 'experimental_movement_not_enabled';
    return null;
  }
  enable(world,opts={}) {
    if(this.active)return {status:'rejected',reason:'autonomy_already_active'};
    if(opts.confirmed!==true)return {status:'rejected',reason:'confirmation_required'};
    const blocker=this.safety(world);
    if(blocker)return {status:'rejected',reason:blocker};
    const path=this.route(world);
    if(path.status!=='ready')return {status:'rejected',reason:path.reason};
    this.world=world;this.active=true;this.phase='ready';
    this.stepCount=0;this.verifiedSteps=0;
    this.startedAt=this.clock();
    this.initialDimension=world.dimension;
    this.awaiting=null;
    this.lastReason='experimental_autonomy_started_not_verified';
    this.interval=this.setInterval(()=>this.pulse(),TICK_MS);
    return {status:'accepted',reason:'bounded_follow_autonomy_started'};
  }
  pulse() {
    if(!this.active)return;
    const w=this.world;
    if (!w || this.clock()-this.startedAt>MAX_RUN_MS ||
       this.stepCount>=MAX_STEPS) {
      this.stop('autonomy_step_or_time_limit');return;
    }
    if(w.dimension!==this.initialDimension) {
      this.stop('dimension_changed');return;
    }
    const blocker=this.safety(w);
    if(blocker){this.stop(blocker);return;}
    const movement=w.movement;
    if(this.awaiting){
      if(movement?.snapshot()?.active)return;
      const observed=w.lastServerPositionAt;
      const progressed=observed!=null&&observed>this.awaiting.observedAt &&
        distance(w.position,this.awaiting.position)>=MIN_PROGRESS;
      if(progressed){
        this.verifiedSteps++;
        this.awaiting=null;
        this.phase='ready';
        return;
      }
      if(this.clock()-this.awaiting.startedAt>ACK_MS) {
        this.stop('server_movement_not_confirmed');return;
      }
      this.phase='awaiting_confirmed_progress';
      return;
    }
    const route=this.route(w);
    if(route.status==='complete') {this.stop('target_reached');return;}
    if(route.status!=='ready'){this.stop(route.reason);return;}
    if(movement?.snapshot()?.active)return;
    const result=movement?.runVerifiedStep(w,route.waypoint,8);
    if(result?.status!=='accepted'){
      this.stop(result?.reason??'movement_rejected');return;
    }
    this.stepCount++;
    this.phase='moving';
    this.awaiting={position:{...w.position},observedAt:w.lastServerPositionAt,
      startedAt:this.clock()};
  }
  stop(reason='user_stopped') {
    if(this.interval) this.clearInterval(this.interval);
    this.interval=null;
    const world=this.world;
    this.world=null;this.active=false;this.phase='idle';
    this.lastReason=reason;
    if(world && world.movement?.snapshot()?.active)
      world.movement.stop('autonomy_cancelled');
  }
  snapshot(){
    return {active:this.active,phase:this.phase,attemptedSteps:this.stepCount,
      serverVerifiedSteps:this.verifiedSteps,stopReason:this.lastReason,
      maxSteps:MAX_STEPS,executed:this.stepCount>0,
      autonomousMining:false,autonomousCombat:false};
  }
}
module.exports={VerifiedAutonomyRunner};
