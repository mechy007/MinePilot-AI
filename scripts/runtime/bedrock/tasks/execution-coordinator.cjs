'use strict';
const {VALID}=require('./runner.cjs');
class TaskExecutionCoordinator {
 constructor(options={}){this.runner=options.runner;this.capabilities=options.capabilities;this.adapter=options.adapter;}
 async execute(task) {
  if(!this.runner||!this.capabilities||!this.adapter)return {status:'rejected',reason:'execution_dependencies_unavailable'};
  const assessment=this.capabilities.assess(this.adapter.snapshot?.()??{});
  if(!assessment.canExecute)return {status:'rejected',reason:'capability_gate_blocked',missing:assessment.missing};
  if(!task||!Array.isArray(task.steps)||task.steps.some(s=>!VALID.has(s?.type)))return {status:'rejected',reason:'task_intent_not_allowlisted'};
  return this.runner.run(task,{
   executeIntent:(intent,ctx)=>this.adapter.executeIntent(intent,ctx),
   verifyOutcome:async ctx=>{
    const outcome=await this.adapter.verifyOutcome(ctx);
    return outcome?.serverObservedSuccess===true?outcome:{status:'failed',reason:'server_postcondition_not_verified',serverObservedSuccess:false};
   }
  });
 }
 cancel(reason){return this.runner?.cancel(reason)??false;}
}
module.exports={TaskExecutionCoordinator};
