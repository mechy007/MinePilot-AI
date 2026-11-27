'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {CapabilityRecoveryEngine}=require('../recovery/engine.cjs');
const {StuckRecovery}=require('../navigation/stuck-recovery.cjs');
const {detectCompatibility,selectAdapter}=require('../compatibility/adapter-selector.cjs');
const {WorldKnowledgeStore}=require('../world/knowledge-store.cjs');
const {createWorldPerception}=require('../world/perception.cjs');
const {BoundedTaskRunner}=require('../tasks/runner.cjs');
const {TaskExecutionCoordinator}=require('../tasks/execution-coordinator.cjs');
test('capability gate reports missing requirements and chooses only compatible strategy',()=>{
 const e=new CapabilityRecoveryEngine({clock:()=>5000});
 const partial=e.assess({sessionOpen:true,spawned:true});
 assert.deepEqual(partial.missing,['movement','terrain','inventory','recipeCatalog']);
 const full={sessionOpen:true,spawned:true,movementCapability:'ready',terrainReady:true,inventoryFresh:true,recipeCatalogFresh:true};
 assert.equal(e.assess(full).canExecute,true);
 assert.equal(e.choose(full,[{id:'move',requires:['movement'],run(){}}]).strategy,'move');
});
test('recovery attempts are bounded and cooldown protected',()=>{
 let now=5000;const e=new CapabilityRecoveryEngine({clock:()=>now,maxAttempts:2,cooldownMs:1000});
 assert.equal(e.recordAttempt('path',{status:'failed'}).allowed,true);
 assert.equal(e.recordAttempt('path',{status:'failed'}).allowed,false);
 now+=1000;assert.equal(e.recordAttempt('path',{status:'failed'}).allowed,false);
 assert.equal(e.recordAttempt('other',{status:'failed'}).allowed,true);
});
test('stuck recovery detects no horizontal progress but ignores neutral or corrected movement',()=>{
 let now=1000;const s=new StuckRecovery({clock:()=>now,windowMs:5000,threshold:4,minProgress:0.1});
 let result;for(let i=0;i<4;i++){result=s.observe({position:{x:1+i*.001,y:64,z:1},inputActive:true,at:now});now+=1000;}
 assert.equal(result.stuck,true);assert.equal(result.executable,false);
 assert.equal(s.observe({position:{x:1,y:64,z:1},inputActive:false}).stuck,false);
 assert.equal(s.snapshot().automaticMovementMutation,false);
});
test('version selector fails closed for unknown or partial version metadata',()=>{
 assert.equal(detectCompatibility({gameVersion:'1.26.66.1',protocol:2225}).verified,false);
 assert.equal(detectCompatibility({gameVersion:'1.26.60',protocol:2225}).verified,true);
 assert.equal(detectCompatibility({protocol:2225}).verified,false);
 assert.equal(selectAdapter({gameVersion:'1.26.66.1',protocol:2225},[{id:'bedrock-protocol-pinned',validate:()=>true}]).usable,false);
});
test('world perception marks observations stale and only returns observed entities',()=>{
 let now=1000;const store=new WorldKnowledgeStore({clock:()=>now});
 store.apply({type:'world.session.started',dimension:0,at:now});
 store.apply({type:'world.block.updated',dimension:0,position:{x:1,y:2,z:3},runtimeId:7,at:now});
 store.apply({type:'world.entity.added',dimension:0,entityId:'42',entityType:'mob',position:{x:2,y:2,z:3},at:now});
 const p=createWorldPerception(store,{clock:()=>now,maxAgeMs:500});
 assert.equal(p.blockObservation(0,1,2,3).status,'observed');
 assert.equal(p.nearbyEntities({x:1,y:2,z:3}).entities.length,1);
 now=2000;assert.equal(p.blockObservation(0,1,2,3).status,'stale');
 store.close();
});
test('task execution coordinator requires capabilities and server-observed outcomes',async()=>{
 const runner=new BoundedTaskRunner();let verified=false;
 const capabilities=new CapabilityRecoveryEngine();
 const adapter={snapshot:()=>({sessionOpen:true,spawned:true,movementCapability:'ready',terrainReady:true,inventoryFresh:true,recipeCatalogFresh:true}),
  async executeIntent(){return {status:'accepted'};},async verifyOutcome(){return {status:'succeeded',serverObservedSuccess:verified};}};
 const c=new TaskExecutionCoordinator({runner,capabilities,adapter});
 const task={id:'test',steps:[{type:'wait_for_observation'}]};
 assert.equal((await c.execute(task)).status,'failed');
 verified=true;assert.equal((await c.execute(task)).status,'completed');
});
