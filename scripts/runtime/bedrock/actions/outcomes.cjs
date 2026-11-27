'use strict';
const TERMINAL=new Set(['succeeded','stalled','cancelled','timed_out']);
function validPoint(v){return v&&['x','y','z'].every(k=>Number.isFinite(v[k]));}
class OutcomeVerifier {
  constructor(options={}){this.clock=options.clock??Date.now;this.timeoutMs=options.timeoutMs??10000;this.maxRuns=options.maxRuns??32;this.runs=new Map();}
  begin(kind,baseline={},options={}){
    if(!['traverse','inventory_delta','block_change','window_state'].includes(kind))throw new TypeError('unsupported_outcome_kind');
    const id=options.id??'outcome-'+this.clock()+'-'+(this.runs.size+1);
    if(typeof id!=='string'||id.length>96||this.runs.has(id))throw new Error('invalid_or_duplicate_outcome_id');
    const run={id,kind,baseline:structuredClone(baseline),expected:structuredClone(options.expected??{}),startedAt:this.clock(),timeoutMs:Math.max(250,Math.min(120000,options.timeoutMs??this.timeoutMs)),samples:0,signature:null,status:'pending',reason:'awaiting_server_observation'};
    this.runs.set(id,run);while(this.runs.size>this.maxRuns)this.runs.delete(this.runs.keys().next().value);return this.view(run);
  }
  observe(id,o={}){
    const r=this.runs.get(id);if(!r)return null;if(TERMINAL.has(r.status))return this.view(r);
    const now=this.clock();
    if(now-r.startedAt>r.timeoutMs){r.status='timed_out';r.reason='server_postcondition_timeout';return this.view(r);}
    if(o.source!=='server'||o.serverObserved!==true||o.fresh!==true||!Number.isFinite(o.observedAt)||now-o.observedAt<0||now-o.observedAt>15000){r.reason='non_authoritative_or_stale_observation_ignored';return this.view(r);}
    const result=evaluate(r,o);
    r.samples=result.signature&&result.signature===r.signature?r.samples+1:(result.signature?1:0);r.signature=result.signature??null;
    if(result.succeeded&&r.samples>=(r.expected.stableSamples??1)){r.status='succeeded';r.reason=result.reason;}
    else if(result.progress){r.status='progress';r.reason=result.reason;}
    else if(now-r.startedAt>=Math.min(r.timeoutMs,r.expected.stallAfterMs??3000)){r.status='stalled';r.reason='server_postcondition_not_observed';}
    return this.view(r);
  }
  cancel(id,reason='cancelled_by_owner'){const r=this.runs.get(id);if(!r||TERMINAL.has(r.status))return false;r.status='cancelled';r.reason=String(reason).slice(0,96);return true;}
  view(r){return {id:r.id,kind:r.kind,status:r.status,reason:r.reason,startedAt:r.startedAt,ageMs:Math.max(0,this.clock()-r.startedAt),serverObservedSuccess:r.status==='succeeded'};}
  snapshot(){return [...this.runs.values()].map(r=>this.view(r));}
  clear(){this.runs.clear();}
}
function evaluate(r,o){
  const b=r.baseline,e=r.expected;
  if(r.kind==='traverse'){
    if(!validPoint(o.position)||!validPoint(e.target))return {reason:'position_or_target_missing'};
    const d=Math.hypot(o.position.x-e.target.x,o.position.y-e.target.y,o.position.z-e.target.z);
    const moved=validPoint(b.position)&&Math.hypot(o.position.x-b.position.x,o.position.y-b.position.y,o.position.z-b.position.z)>=0.08;
    return {progress:moved,succeeded:d<=(e.tolerance??1.2),reason:d<=(e.tolerance??1.2)?'target_position_server_observed':'server_position_progress_observed',signature:[o.position.x,o.position.y,o.position.z].map(v=>Math.round(v*20)).join(':')};
  }
  if(r.kind==='inventory_delta'){
    const before=b.itemCounts?.[e.item]??0,after=o.itemCounts?.[e.item];if(!Number.isFinite(after))return {reason:'item_count_not_observed'};
    const delta=after-before;return {progress:delta>0,succeeded:delta>=(e.count??1),reason:delta>=(e.count??1)?'inventory_increase_server_observed':'inventory_delta_observed',signature:e.item+':'+after};
  }
  if(r.kind==='block_change'){
    if(typeof o.blockName!=='string')return {reason:'block_state_not_observed'};
    const changed=o.blockName!==b.blockName,matches=e.blockName?o.blockName===e.blockName:changed;
    return {progress:changed,succeeded:matches,reason:matches?'block_state_server_observed':'block_state_changed',signature:o.blockName};
  }
  if(r.kind==='window_state'){
    const open=o.windowOpen===true,expected=e.open===true;
    return {progress:open!==(b.windowOpen===true),succeeded:open===expected,reason:'container_state_server_observed',signature:'window:'+open+':'+(o.windowId??'none')};
  }
  return {reason:'unsupported_outcome_kind'};
}
module.exports={OutcomeVerifier,evaluate,validPoint};
