import test from 'node:test';
import assert from 'node:assert/strict';
import {MovementAuthority,TaskScheduler,Priority,assessSurvival,AutonomyCore} from './autonomy-core.js';
test('survival overrides task movement',()=>{
 const nav=new MovementAuthority();let target;
 nav.request('task',{x:10,y:0,z:0},Priority.TASK,1);
 nav.request('survival',{x:0,y:1,z:0},Priority.SURVIVAL,1);
 assert.equal(nav.step({x:0,y:0,z:0},1,{moveToward:p=>target=p}).source,'survival');
 assert.equal(target.y,1);
});
test('requests expire and stalled navigation is reported',()=>{
 const nav=new MovementAuthority({ttlTicks:2,stallTicks:2});let stalls=0;
 nav.request('task',{x:10,y:0,z:0},30,1);
 nav.step({x:0,y:0,z:0},1);
 nav.step({x:0,y:0,z:0},2);
 assert.equal(nav.step({x:0,y:0,z:0},3,{onStall:()=>stalls++}).status,'stalled');
 assert.equal(stalls,1);
 assert.equal(nav.step({x:0,y:0,z:0},4).status,'idle');
});
test('tasks complete, retry, and reject duplicate IDs',()=>{
 const jobs=new TaskScheduler({maxAttempts:2});
 assert.equal(jobs.enqueue({id:'mine-1',type:'mine'}),true);
 assert.equal(jobs.enqueue({id:'mine-1',type:'mine'}),false);
 assert.equal(jobs.step(0,()=>({status:'failed'})).status,'retry');
 assert.equal(jobs.step(1,()=>({status:'done'})).status,'done');
});
test('hazards preempt work and report safety action',()=>{
 const core=new AutonomyCore();core.tasks.enqueue({id:'gather',type:'gather'});
 let executed=0;
 const out=core.tick({tick:1,position:{x:0,y:0,z:0},observation:{burning:true,safePosition:{x:2,y:0,z:0}},executeTask:()=>{executed++;return {status:'done'};}});
 assert.equal(out.task.status,'paused_for_survival');assert.equal(executed,0);assert.equal(out.movement.source,'survival');
 assert.equal(assessSurvival({drowning:true}).action,'surface');
});
