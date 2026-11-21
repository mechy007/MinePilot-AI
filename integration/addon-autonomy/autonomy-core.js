/**
 * Platform-neutral MinePilot autonomy core.
 * Original implementation informed by inspection of user-provided Bedrock add-ons.
 * Does NOT import @minecraft/server and does not implement RakNet/authentication.
 * Inject world observation and movement/action adapters from the Android bot runtime.
 */
export const Priority = Object.freeze({ IDLE: 10, FOLLOW: 20, TASK: 30, COMBAT: 50, SURVIVAL: 60 });
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const validPoint = p => p && [p.x,p.y,p.z].every(Number.isFinite);
export class MovementAuthority {
  constructor({ ttlTicks=20, stallTicks=25, progressDistance=0.12 }={}) {
    this.ttlTicks=ttlTicks; this.stallTicks=stallTicks; this.progressDistance=progressDistance;
    // progressDistance measures cumulative displacement from the last progress anchor.
    this.requests=new Map(); this.last=null; this.stalled=0; this.tick=0;
  }
  request(source, target, priority=Priority.TASK, tick=this.tick) {
    if(!source || !validPoint(target) || !Number.isFinite(priority)) throw new TypeError('Invalid movement request');
    this.requests.set(source,{ source,target:{...target},priority,expires:tick+this.ttlTicks });
  }
  release(source) { this.requests.delete(source); }
  clear() { this.requests.clear(); this.last=null; this.stalled=0; }
  step(position,tick,adapter) {
    if(!validPoint(position) || !Number.isFinite(tick)) throw new TypeError('Invalid movement state');
    this.tick=tick;
    for(const [key,req] of this.requests) if(req.expires<tick) this.requests.delete(key);
    const winner=[...this.requests.values()].sort((a,b)=>b.priority-a.priority || a.source.localeCompare(b.source))[0];
    if(!winner){this.last=null;this.stalled=0;return {status:'idle'};}
    if(this.last && this.last.source===winner.source && distance(this.last.target,winner.target)<0.001 && distance(this.last.position,position)<this.progressDistance) this.stalled++;
    else {this.stalled=0;this.last={source:winner.source,target:{...winner.target},position:{...position}};}
    if(this.stalled>=this.stallTicks) {
      adapter?.onStall?.({source:winner.source,target:winner.target,position,stalledTicks:this.stalled});
      this.stalled=0;
      this.last={source:winner.source,target:{...winner.target},position:{...position}};
      return {status:'stalled',source:winner.source};
    }
    adapter?.moveToward?.(winner.target,{source:winner.source,priority:winner.priority});
    return {status:'moving',source:winner.source,target:winner.target};
  }
}
export class TaskScheduler {
  constructor({maxAttempts=5,timeoutTicks=1800}={}) {
    this.maxAttempts=maxAttempts;this.timeoutTicks=timeoutTicks;this.queue=[];this.active=null;
  }
  enqueue(task) {
    if(!task || typeof task.id!=='string' || !task.id || typeof task.type!=='string') throw new TypeError('Task requires id and type');
    if(this.queue.some(t=>t.id===task.id)||this.active?.id===task.id) return false;
    this.queue.push({...task,state:'queued',attempts:0});return true;
  }
  cancel(id) {
    const before=this.queue.length;this.queue=this.queue.filter(t=>t.id!==id);
    if(this.active?.id===id){this.active=null;return true;}
    return before!==this.queue.length;
  }
  step(tick,executor) {
    if(!Number.isFinite(tick) || typeof executor!=='function') throw new TypeError('Invalid task step');
    this.lastTick=tick;
    if(!this.active && this.queue.length){this.active=this.queue.shift();this.active.started=tick;this.active.state='running';}
    const task=this.active;if(!task)return {status:'idle'};
    if(tick-task.started>this.timeoutTicks)return this.retry(task,tick,'timeout');
    try {
      const result=executor({...task});
      if(result?.status==='done'){this.active=null;return {status:'done',task:task.id};}
      if(result?.status==='failed')return this.retry(task,tick,result.reason||'failed');
      return {status:'running',task:task.id};
    } catch(error){return this.retry(task,tick,String(error?.message||error));}
  }
  pause(tick) {
    // Survival pauses do not consume task timeout or retry attempts.
    if(this.active && Number.isFinite(this.lastTick)) this.active.started+=Math.max(0,tick-this.lastTick);
    this.lastTick=tick;
  }
  retry(task,tick,reason) {
    task.attempts++;
    if(task.attempts>=this.maxAttempts){this.active=null;return {status:'failed',task:task.id,reason,attempts:task.attempts};}
    task.started=tick;return {status:'retry',task:task.id,reason,attempts:task.attempts};
  }
}
export function assessSurvival(observation={}) {
  if(observation.inLava || observation.burning) return {priority:Priority.SURVIVAL,action:'escape_fire'};
  if(observation.drowning || observation.underwaterAirLow) return {priority:Priority.SURVIVAL,action:'surface'};
  if(observation.nearCliff || observation.unsafeLanding) return {priority:Priority.SURVIVAL,action:'avoid_fall'};
  if(observation.healthRatio!==undefined && observation.healthRatio<0.25) return {priority:Priority.SURVIVAL,action:'retreat_heal'};
  return {priority:Priority.IDLE,action:'none'};
}
export class AutonomyCore {
  constructor(options={}){this.movement=new MovementAuthority(options.movement);this.tasks=new TaskScheduler(options.tasks);}
  tick({tick,position,observation={},adapter,executeTask}) {
    this.movement.tick=tick;
    const survival=assessSurvival(observation);
    if(survival.priority===Priority.SURVIVAL) {
      this.tasks.pause(tick);
      if(validPoint(observation.safePosition))this.movement.request('survival',observation.safePosition,Priority.SURVIVAL,tick);
      else this.movement.release('survival');
      adapter?.onSurvival?.(survival);
    } else this.movement.release('survival');
    const taskResult=survival.priority===Priority.SURVIVAL?{status:'paused_for_survival'}:this.tasks.step(tick,executeTask||(()=>({status:'running'})));
    const movementResult=survival.priority===Priority.SURVIVAL && !validPoint(observation.safePosition)
      ? {status:'suspended_for_survival'} : this.movement.step(position,tick,adapter);
    return {survival,task:taskResult,movement:movementResult};
  }
}
