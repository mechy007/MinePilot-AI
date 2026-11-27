'use strict';
const {MAX_TASK_STEPS,MAX_TASK_BUDGET_MS}=require('../contracts.cjs');
const VALID=new Set(['move_to','collect_observed_drop','mine_observed_block','craft_observed_recipe','place_observed_block','wait_for_observation','stop']);
class BoundedTaskRunner {
  constructor(options={}){this.clock=options.clock??Date.now;this.maxSteps=options.maxSteps??MAX_TASK_STEPS;this.maxBudgetMs=options.maxBudgetMs??MAX_TASK_BUDGET_MS;this.active=null;}
  async run(task,adapter={}){
    if(this.active)return {status:'rejected',reason:'task_runner_busy'};
    if(!task||!Array.isArray(task.steps)||!task.steps.length||task.steps.length>this.maxSteps||typeof adapter.executeIntent!=='function'||typeof adapter.verifyOutcome!=='function')return {status:'rejected',reason:'invalid_task_or_adapter'};
    const budget=Math.max(250,Math.min(this.maxBudgetMs,task.budgetMs??this.maxBudgetMs)),controller=new AbortController(),active={id:String(task.id??'task').slice(0,80),controller,startedAt:this.clock(),attempted:0,verified:0};this.active=active;const results=[];
    try{for(const [index,intent] of task.steps.entries()){
      if(controller.signal.aborted)return result(active,'cancelled','task_cancelled',results);
      if(this.clock()-active.startedAt>budget)return result(active,'timed_out','task_budget_exhausted',results);
      if(!intent||typeof intent!=='object'||Array.isArray(intent)||!VALID.has(intent.type))return result(active,'rejected','intent_not_allowlisted',results);
      active.attempted++;const dispatch=await adapter.executeIntent(structuredClone(intent),{signal:controller.signal,taskId:active.id,stepIndex:index});
      if(!['accepted','ok'].includes(dispatch?.status))return result(active,'failed',dispatch?.reason??'intent_dispatch_rejected',results);
      const outcome=await adapter.verifyOutcome({intent:structuredClone(intent),dispatch,signal:controller.signal,taskId:active.id,stepIndex:index});
      if(outcome?.status!=='succeeded'||outcome.serverObservedSuccess!==true)return result(active,'failed',outcome?.reason??'server_postcondition_not_verified',results);
      active.verified++;results.push({step:index,status:'succeeded',evidence:'server_observed'});
    }return result(active,'completed','all_steps_server_verified',results);
    }catch{return result(active,controller.signal.aborted?'cancelled':'failed',controller.signal.aborted?'task_cancelled':'task_adapter_error',results);}
    finally{if(this.active===active)this.active=null;}
  }
  cancel(reason='user_stopped'){if(!this.active)return false;this.active.controller.abort(new Error(String(reason).slice(0,96)));return true;}
  snapshot(){const a=this.active;return a?{active:true,id:a.id,attempted:a.attempted,verified:a.verified,ageMs:this.clock()-a.startedAt,cancellationSupported:true,emitsPackets:false}:{active:false,emitsPackets:false};}
}
function result(a,status,reason,steps){return {status,reason,taskId:a.id,attempted:a.attempted,serverVerifiedSteps:a.verified,steps,executable:false,executorBoundary:'caller_supplied_validated_minepilot_adapter'};}
module.exports={BoundedTaskRunner,VALID};
