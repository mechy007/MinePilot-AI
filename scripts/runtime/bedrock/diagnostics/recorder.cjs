'use strict';
const ALLOWED=new Set(['status','inspect','plan_obtain','plan_follow','plan_return','plan_collect','plan_workflow','manual_move','manual_stop','stop_movement','agent_start','agent_stop','learning_start','learning_stop','odyssey_observe','odyssey_execute']);
class RuntimeRecorder {
  constructor(options={}){this.clock=options.clock??Date.now;this.capacity=Math.max(16,Math.min(512,options.capacity??128));this.events=[];this.sequence=0;}
  recordCommand(command,result){const action=ALLOWED.has(command?.action)?command.action:'unknown';const statuses=new Set(['ok','accepted','preview','blocked','rejected','failed']);const status=statuses.has(result?.status)?result.status:'unknown';const reason=typeof result?.reason==='string'?result.reason.slice(0,96):'unspecified';const requestId=typeof command?.requestId==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(command.requestId)?command.requestId:null;this.push({action,status,reason,requestId,serverVerified:result?.serverVerified===true});}
  recordSystem(type,detail={}){const allowed=new Set(['session_started','session_closed','protocol_warning','task_outcome']);this.push({type:allowed.has(type)?type:'system_event',outcome:typeof detail.outcome==='string'?detail.outcome.slice(0,48):null,reason:typeof detail.reason==='string'?detail.reason.slice(0,96):null});}
  push(event){this.events.push({sequence:++this.sequence,at:this.clock(),...event});if(this.events.length>this.capacity)this.events.shift();}
  snapshot(limit=32){return this.events.slice(-Math.max(0,Math.min(this.capacity,limit))).map(x=>({...x}));}
  clear(){this.events=[];}
}
module.exports={RuntimeRecorder,ALLOWED};
