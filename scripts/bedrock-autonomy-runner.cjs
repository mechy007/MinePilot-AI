'use strict';

/**
 * Experimental, finite autonomy loop for a standalone Xbox Bedrock player.
 * It executes actual (bounded) auth-input pulses on verified terrain. Each step
 * is reconciled against a server position update when one arrives; if Bedrock
 * sends no correction, it continues only when local physics predicts real
 * progress after a grace period. It never attacks, breaks or places blocks.
 */
const TICK_MS=250;
const MAX_STEPS=20;
const MAX_RUN_MS=30000;
const CORRECTION_GRACE_MS=1200;
const MIN_PROGRESS=0.08;
function distance(a,b) {
  return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
}
function finite3(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
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
    this.predictionSteps=0;
    this.followMode=false;
  }
  route(world) {
    const plan=world.layerTwo?.preview(world.gameplayWorld());
    if (!plan || !['follow','return'].includes(plan.goal))
      return {status:'rejected',reason:'no_selected_follow_or_return'};
    if (plan.goal === 'follow' && plan.status === 'at_target')
      return {status:'holding',reason:'target_within_follow_distance'};
    if (plan.goal === 'follow' && plan.status === 'waiting_for_target')
      return {status:'waiting',reason:plan.reason??'player_position_stale'};
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
    if (world.blockBreaker?.snapshot()?.active) return 'block_action_busy';
    if (world.movement?.capability(world)!=='ready')
      return 'movement_unavailable';
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
    this.stepCount=0;this.verifiedSteps=0;this.predictionSteps=0;
    this.followMode=world.layerTwo?.preview(world.gameplayWorld())?.goal==='follow';
    this.startedAt=this.clock();
    this.initialDimension=world.dimension;
    this.awaiting=null;
    this.lastReason='autonomy_started_not_verified';
    this.interval=this.setInterval(()=>this.pulse(),TICK_MS);
    return {status:'accepted',reason:'bounded_follow_autonomy_started'};
  }
  pulse() {
    if(!this.active)return;
    const w=this.world;
    if (!w || (!this.followMode && (this.clock()-this.startedAt>MAX_RUN_MS ||
       this.stepCount>=MAX_STEPS))) {
      this.stop('autonomy_step_or_time_limit');return;
    }
    if(w.dimension!==this.initialDimension) {
      this.stop('dimension_changed');return;
    }
    const blocker=this.safety(w);
    if(blocker){this.stop(blocker);return;}
    const movement=w.movement;
    if(this.awaiting){
      const motion=movement?.snapshot?.()??{};
      if(motion.active)return;
      const observed=w.lastServerPositionAt;
      const serverPositionChanged=observed!=null&&observed>this.awaiting.observedAt;
      if(serverPositionChanged){
        const serverProgressed=distance(w.position,this.awaiting.position)>=MIN_PROGRESS;
        if(serverProgressed){
          this.verifiedSteps++;
          this.awaiting=null;
          this.phase='ready';
          return;
        }
        this.stop('server_corrected_without_progress');
        return;
      }
      const predicted=motion.predictedPosition;
      const predictionProgressed=finite3(predicted)&&finite3(this.awaiting.predictedPosition)&&
        distance(predicted,this.awaiting.predictedPosition)>=MIN_PROGRESS;
      if(this.clock()-this.awaiting.startedAt>=CORRECTION_GRACE_MS){
        if(predictionProgressed){
          // No correction means the server has not contradicted the submitted
          // prediction. Continue from that local, collision-checked position;
          // never label this as server-verified progress.
          w.position={...predicted};
          this.predictionSteps++;
          this.awaiting=null;
          this.phase='prediction_uncontradicted';
          return;
        }
        this.stop('movement_prediction_no_progress');
        return;
      }
      this.phase='awaiting_server_correction';
      return;
    }
    const route=this.route(w);
    if (route.status === 'holding' || route.status === 'waiting') {
      // Follow is a persistent escort: hold position inside the comfort radius
      // and wait safely while the target is temporarily out of observation.
      // A fresh target packet automatically resumes route planning on a later pulse.
      if (movement?.snapshot()?.active) movement.stop('follow_hold_position');
      this.awaiting=null;
      this.phase=route.status==='holding'?'holding_follow_distance':'waiting_for_target';
      this.lastReason=route.reason;
      return;
    }
    if(route.status==='complete') {this.stop('target_reached');return;}
    if(route.status!=='ready'){this.stop(route.reason);return;}
    if(movement?.snapshot()?.active)return;
    const predictedBefore=movement?.snapshot?.()?.predictedPosition;
    const result=movement?.runVerifiedStep(w,route.waypoint,8);
    if(result?.status!=='accepted'){
      this.stop(result?.reason??'movement_rejected');return;
    }
    this.stepCount++;
    this.phase='moving';
    this.awaiting={position:{...w.position},
      predictedPosition:finite3(predictedBefore)?{...predictedBefore}:{...w.position},
      observedAt:w.lastServerPositionAt,startedAt:this.clock()};
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
    return {active:this.active,mode:this.followMode?'continuous_follow':'bounded_task',
      phase:this.phase,attemptedSteps:this.stepCount,
      serverVerifiedSteps:this.verifiedSteps,predictionSteps:this.predictionSteps,
      stopReason:this.lastReason,
      maxSteps:this.followMode?null:MAX_STEPS,executed:this.stepCount>0,
      autonomousMining:false,autonomousCombat:false};
  }
}
module.exports={VerifiedAutonomyRunner};
