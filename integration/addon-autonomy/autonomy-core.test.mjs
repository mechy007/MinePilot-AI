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

test('slow cumulative progress is not incorrectly stalled',()=>{
 const nav=new MovementAuthority({stallTicks:3,progressDistance:0.12});
 nav.request('follow',{x:5,y:0,z:0},Priority.FOLLOW,1);
 for(let t=1;t<=12;t++) assert.notEqual(nav.step({x:t*0.05,y:0,z:0},t).status,'stalled');
});
test('survival without a safe position suppresses follow movement',()=>{
 const core=new AutonomyCore();let moves=0;
 core.movement.request('follow',{x:10,y:0,z:0},Priority.FOLLOW,1);
 const result=core.tick({tick:2,position:{x:0,y:0,z:0},observation:{drowning:true},adapter:{moveToward:()=>moves++}});
 assert.equal(result.movement.status,'suspended_for_survival');
 assert.equal(moves,0);
});
test('task callbacks receive current movement clock',()=>{
 const core=new AutonomyCore();
 core.tasks.enqueue({id:'walk',type:'move'});
 core.tick({tick:100,position:{x:0,y:0,z:0},executeTask:()=>{
   core.movement.request('task',{x:1,y:0,z:0});
   return {status:'running'};
 }});
 assert.equal(core.movement.requests.get('task').expires,120);
});
test('survival pause does not consume task timeout',()=>{
 const core=new AutonomyCore({tasks:{timeoutTicks:2}});
 core.tasks.enqueue({id:'gather',type:'gather'});
 const pos={x:0,y:0,z:0};
 core.tick({tick:1,position:pos,executeTask:()=>({status:'running'})});
 for(let tick=2;tick<=100;tick++)core.tick({tick,position:pos,observation:{drowning:true}});
 const resumed=core.tick({tick:101,position:pos,executeTask:()=>({status:'done'})});
 assert.equal(resumed.task.status,'done');
});
