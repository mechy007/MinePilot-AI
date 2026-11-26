'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {BedrockGameplayBridge}=require('../../../../scripts/bedrock-gameplay-bridge.cjs');
const {ActionEnvelope}=require('../actions/envelope.cjs');
const {OutcomeVerifier}=require('../actions/outcomes.cjs');
const {resolveWindow,planPickup,planQuickMove}=require('../inventory/containers.cjs');
const {searchGridAStar}=require('../navigation/astar.cjs');
const {planGoap}=require('../planning/goap.cjs');
const {BedrockObtainPlanner}=require('../planning/obtain.cjs');
const {BoundedTaskRunner}=require('../tasks/runner.cjs');
const {VerifiedCurriculum}=require('../learning/curriculum.cjs');
const {RuntimeRecorder}=require('../diagnostics/recorder.cjs');
const {createRuntimeExtensions}=require('../index.cjs');

test('action envelope requires confirmation and fresh state; stop always passes',()=>{
 const e=new ActionEnvelope();
 assert.equal(e.evaluate('manual_move',{}).reason,'confirmation_required');
 assert.equal(e.evaluate('emergency_stop',{}).allowed,true);
 assert.equal(e.evaluate('manual_move',{confirmed:true,worldReady:true,sessionClosed:false,freshPosition:true,freshObservation:true,safetyHold:false,controllerBusy:false,executorAvailable:true,capabilityAvailable:true}).allowed,true);
});
test('control mask releases controls previously held but now forbidden',()=>{
 const r=new ActionEnvelope().maskControls({forward:true,jump:true},{forward:false,jump:true},{forward:true});
 assert.equal(r.controls.forward,false);assert.deepEqual(r.released,['forward']);
});
test('outcome verifier ignores predictions and requires fresh server evidence',()=>{
 let now=1000;const v=new OutcomeVerifier({clock:()=>now});
 const run=v.begin('inventory_delta',{itemCounts:{'minecraft:oak_log':1}},{id:'test',expected:{item:'minecraft:oak_log',count:1}});
 assert.equal(v.observe(run.id,{source:'client',serverObserved:false,fresh:true,observedAt:now,itemCounts:{'minecraft:oak_log':2}}).status,'pending');
 assert.equal(v.observe(run.id,{source:'server',serverObserved:true,fresh:true,observedAt:now,itemCounts:{'minecraft:oak_log':2}}).status,'succeeded');
});
test('Bedboo-inspired registry resolves chest and furnace slots',()=>{
 const chest=resolveWindow({window_id:4,window_type:'container',slot_count:27},{blockName:'minecraft:chest'});
 assert.equal(chest.status,'resolved');assert.equal(chest.slotMap[0].container_id,'container');
 const furnace=resolveWindow({window_id:5,window_type:'furnace',slot_count:3});
 assert.equal(furnace.slotMap[0].container_id,'furnace_ingredient');assert.equal(furnace.slotMap[1].container_id,'furnace_fuel');
});
test('click and quick-move planners return previews only',()=>{
 const half=planPickup([{name:'minecraft:oak_log',count:5}],null,0,1);
 assert.equal(half.steps[0].count,3);assert.equal(half.executable,false);
 const moved=planQuickMove([{name:'minecraft:oak_log',count:60},null,{name:'minecraft:stone',count:1}],2,[0,1]);
 assert.equal(moved.status,'preview');assert.equal(moved.remaining,0);
 const limited=planQuickMove([{name:'minecraft:oak_log',count:20},null],0,[1],{slotLimit:16});
 assert.equal(limited.steps[0].count,16);assert.equal(limited.remaining,4);
});
test('heap A* finds a detour around a verified obstacle',()=>{
 const r=searchGridAStar({start:{x:0,z:0},target:{x:2,z:0},isWalkable:(x,z)=>!(x===1&&z===0),radius:5,maxExpanded:100});
 assert.equal(r.status,'found');assert.ok(r.path.length>=5);
 const fail=searchGridAStar({start:{x:0,z:0},target:{x:2,z:0},isWalkable:()=>false});
 assert.equal(fail.status,'unverified');
});
test('GOAP returns bounded preview and never an executable task',()=>{
 const r=planGoap({log:true,planks:false},{planks:true},[{id:'craft_planks',cost:1,preconditions:{log:true,planks:false},effects:{planks:true},intent:{type:'craft_observed_recipe'}}]);
 assert.equal(r.status,'preview');assert.equal(r.executable,false);assert.equal(r.steps[0].id,'craft_planks');
});
test('Bedboo obtain planner adapts MinePilot-observed inventory and recipes',()=>{
 const planner=new BedrockObtainPlanner({clock:()=>1000});
 const bridge={closed:false,spawned:true,
  inventoryLedger:{playerInventory:()=>({known:true,fresh:true,registryKnown:true,unresolvedItemCount:0,observedAt:1000,revision:4,generation:2,items:[{empty:false,itemName:'minecraft:oak_log',count:1}]})},
  recipeCatalog:{snapshot:()=>({observedAt:1000,generation:3,recipes:[{supported:true,id:'oak_planks',resultItem:'minecraft:oak_planks',resultCount:4,ingredients:[{name:'minecraft:oak_log',count:1}]}]})}};
 const result=planner.preview(bridge,'minecraft:oak_planks',4);
 assert.equal(result.status,'preview');assert.equal(result.executable,false);
 assert.equal(result.source,'bedboo_obtain_planner');
});
test('bounded task runner requires a server-verified postcondition',async()=>{
 const runner=new BoundedTaskRunner();
 const fail=await runner.run({id:'not-verified',steps:[{type:'move_to'}]},{executeIntent:async()=>({status:'accepted'}),verifyOutcome:async()=>({status:'succeeded',serverObservedSuccess:false})});
 assert.equal(fail.status,'failed');
 const ok=await runner.run({id:'verified',steps:[{type:'wait_for_observation'}]},{executeIntent:async()=>({status:'accepted'}),verifyOutcome:async()=>({status:'succeeded',serverObservedSuccess:true})});
 assert.equal(ok.status,'completed');
});
test('curriculum learns only verified success and never auto-starts',()=>{
 const c=new VerifiedCurriculum();
 assert.equal(c.recordOutcome('inspect_world',{status:'succeeded',serverObservedSuccess:false}).status,'ignored');
 c.recordOutcome('inspect_world',{status:'succeeded',serverObservedSuccess:true});
 assert.equal(c.nextProposal().skillId,'follow_selected_player');assert.equal(c.snapshot().autoStart,false);
});
test('diagnostics omit arbitrary credentials and payloads',()=>{
 const r=new RuntimeRecorder();r.recordCommand({action:'status',requestId:'ok_1',accessToken:'secret'},{status:'ok',reason:'snapshot_available'});
 const [event]=r.snapshot();assert.equal(event.action,'status');assert.equal(Object.hasOwn(event,'accessToken'),false);
});
test('runtime facade declares target Bedrock version unverified',()=>{
 const s=createRuntimeExtensions().snapshot();
 assert.equal(s.targetGameVersion,'1.26.66.1');assert.equal(s.targetVersionVerified,false);
 assert.equal(s.planners.obtain,'preview_only');
});

test('live bridge exposes Bedboo obtain planning as a non-executing command',()=>{
 const clock=()=>1000;
 const bridge=new BedrockGameplayBridge(new EventEmitter(),{
  clock,
  inventoryLedger:{playerInventory:()=>({known:true,fresh:true,registryKnown:true,unresolvedItemCount:0,observedAt:1000,revision:1,generation:1,items:[{empty:false,itemName:'minecraft:oak_log',count:1}]})},
  recipeCatalog:{snapshot:()=>({observedAt:1000,generation:1,recipes:[{supported:true,id:'oak_planks',resultItem:'minecraft:oak_planks',resultCount:4,ingredients:[{name:'minecraft:oak_log',count:1}]}]})}
 });
 bridge.spawned=true;
 const result=bridge.execute({version:'minepilot.gameplay.v1',requestId:'obtain_1',action:'plan_obtain',itemName:'minecraft:oak_planks',count:4});
 assert.equal(result.status,'preview');
 assert.equal(result.executable,false);
 assert.equal(result.source,'bedboo_obtain_planner');
 bridge.stop();
});
