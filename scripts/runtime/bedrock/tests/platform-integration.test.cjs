'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {RuntimeEventBus}=require('../events/event-bus.cjs');
const {normalizePacket}=require('../adapters/packet-normalizer.cjs');
const {WorldKnowledgeStore}=require('../world/knowledge-store.cjs');
const {normalizeExternalRegistry,compareRegistries}=require('../registry/adapter.cjs');
const {searchVoxelAStar,GoalBlock,GoalNear,GoalFollow}=require('../navigation/voxel.cjs');
const {fallTimeCost}=require('../navigation/costs.cjs');
const {ReadOnlyPluginRegistry}=require('../plugins/registry.cjs');
const {describePacketFixture,comparePacketFixtures}=require('../protocol/differential.cjs');
const {createRuntimeExtensions}=require('../index.cjs');
test('event bus orders listeners, isolates errors and supports unsubscribe',()=>{
 const bus=new RuntimeEventBus({clock:()=>100}),calls=[];
 bus.subscribe('world.chunk.observed',()=>calls.push('normal'));
 const high=bus.subscribe('world.chunk.observed',()=>calls.push('high'),{priority:10});
 bus.subscribe('world.chunk.observed',()=>{throw Error('plugin failure');},{priority:5});
 const result=bus.emit('world.chunk.observed',{x:1});
 assert.deepEqual(calls,['high','normal']);assert.equal(result.errors,1);assert.equal(high.unsubscribe(),true);
 assert.equal(bus.snapshot().listeners,2);bus.close();
});
test('normalizer projects safe fields, freezes nested data and omits player identity',()=>{
 const event=normalizePacket('add_player',{runtime_entity_id:12n,uuid:'private-uuid',username:'PrivateGamertag',
  position:{x:1,y:64,z:2}},{dimension:0},1000);
 assert.equal(event.type,'world.entity.added');assert.equal(event.entityId,'12');
 assert.equal(Object.hasOwn(event,'uuid'),false);assert.equal(Object.hasOwn(event,'username'),false);
 assert.equal(normalizePacket('chat',{message:'private'},{},1000),null);
 assert.equal(Object.isFrozen(event),true);assert.equal(Object.isFrozen(event.position),true);
});
test('world knowledge is bounded, dimension-aware and does not duplicate inventory',()=>{
 const store=new WorldKnowledgeStore({clock:()=>1000,maxChunks:16});
 store.apply({type:'world.session.started',at:1000,dimension:0,gameVersion:'1.26.60'});
 for(let x=0;x<40;x++)store.apply({type:'world.chunk.observed',at:1000+x,dimension:0,x,z:0,
  subChunkCount:4,cacheEnabled:false,payloadBytes:0});
 assert.equal(store.snapshot().chunks,16);assert.equal(store.getChunk(0,39,0).x,39);assert.equal(store.getChunk(1,39,0),null);
 assert.equal(store.apply({type:'inventory.snapshot.observed',at:1100,counts:{'minecraft:stone':3}}),true);
 assert.equal(Object.hasOwn(store.snapshot(),'inventory'),false);
});
test('dimension changes clear old spatial data and follow targets expire',()=>{
 let now=1000;const store=new WorldKnowledgeStore({clock:()=>now});
 store.apply({type:'world.session.started',at:now,dimension:0,gameVersion:'1.26.60'});
 store.apply({type:'world.entity.added',at:now,entityId:'8',entityType:'player',dimension:0,position:{x:1,y:64,z:1}});
 store.apply({type:'world.chunk.observed',at:now,dimension:0,x:0,z:0});
 assert.deepEqual(store.getEntityPosition('8'),{x:1,y:64,z:1});
 now=7000;assert.equal(store.getEntityPosition('8'),null);
 const projected=normalizePacket('change_dimension',{dimension:1},{dimension:1},now);
 assert.equal(projected.type,'world.dimension.changed');store.apply(projected);
 assert.equal(store.snapshot().dimension,1);assert.equal(store.snapshot().chunks,0);assert.equal(store.snapshot().entities,0);
});
test('external registry requires exact verified codec baseline and has no live authority',()=>{
 const source=new Map([[1,{name:'stone',boundingBox:'block',fullCube:true,collisionVerified:true}]]);
 const blocked=normalizeExternalRegistry(source,{source:'reference',gameVersion:'1.26.66.1',protocol:2225,hashed:true,verified:true});
 assert.equal(blocked.status,'rejected');
 const accepted=normalizeExternalRegistry(source,{source:'fixture',gameVersion:'1.26.60',protocol:2225,hashed:true,verified:true});
 assert.equal(accepted.status,'cross_check_ready');assert.equal(accepted.compatible,false);assert.equal(accepted.liveMovementAuthority,false);
 assert.equal(compareRegistries(accepted.registry,new Map([[1,{name:'minecraft:stone',boundingBox:'block'}]])).status,'matched_subset');
});
test('voxel A* supports validated 3D edges and returns preview-only route',()=>{
 const walkable=(x,y,z)=>(y===64&&!(x===1&&z===0))||(x===1&&y===65&&z===0);
 const result=searchVoxelAStar({start:{x:0,y:64,z:0},goal:new GoalBlock(2,64,0),isStandable:walkable,
  horizontalRadius:5,verticalRadius:2,maxExpanded:100,
  getNeighbors:n=>[{x:n.x+1,y:n.y,z:n.z,mode:'walk',verified:true},{x:n.x-1,y:n.y,z:n.z,mode:'walk',verified:true},
   {x:n.x,y:n.y,z:n.z+1,mode:'walk',verified:true},{x:n.x,y:n.y,z:n.z-1,mode:'walk',verified:true},
   {x:n.x,y:n.y+1,z:n.z,mode:'jump',verified:true}],
  canTraverse:(from,to,e)=>e.verified===true&&(to.y===from.y||(to.y===from.y+1&&from.x===0&&from.z===0))});
 assert.equal(result.status,'preview');assert.equal(result.executable,false);assert.ok(result.path.length>=4);
 assert.equal(new GoalNear(2,64,0,1).isEnd({x:2,y:64,z:0}),true);
});
test('fall-time estimator rejects invalid and unbounded input',()=>{
 assert.ok(fallTimeCost(5)>0);assert.equal(fallTimeCost(-1),Infinity);assert.equal(fallTimeCost(5000),Infinity);
});
test('plugin registry rejects write capability and only runs static read-only plugin',()=>{
 const registry=new ReadOnlyPluginRegistry();
 assert.equal(registry.register({id:'unsafe-writer',version:'1.0.0',capabilities:['packet.write'],onEvent(){}}).status,'rejected');
 const seen=[];
 assert.equal(registry.register({id:'world-watcher',version:'1.0.0',capabilities:['world.observe','terrain.read'],
  onStart:api=>assert.equal(api.readOnly,true),onEvent:event=>seen.push(event.type)}).status,'registered');
 registry.start();registry.publish({type:'world.chunk.observed',at:10,x:0,z:0});
 assert.deepEqual(seen,['world.chunk.observed']);assert.equal(registry.snapshot().dynamicImports,false);registry.close();
});
test('protocol fixture comparer detects schema disagreements without decoding live traffic',()=>{
 const a=describePacketFixture('sub_chunk',{dimension:'number',center:{x:'number',y:'number',z:'number'},entries:[]});
 const b=describePacketFixture('subchunk',{dimension:'number',origin:{x:'number',y:'number',z:'number'},entries:[]});
 assert.equal(a.canonical,'subchunk');assert.equal(comparePacketFixtures(a,b).status,'mismatch');
});
test('runtime facade connects event bus, normalizer, world store, terrain planner and follow goals',()=>{
 const runtime=createRuntimeExtensions({clock:()=>1000}),seen=[];
 runtime.events.subscribe('world.chunk.observed',event=>seen.push(event.payload.x));
 const event=runtime.observePacket('level_chunk',{x:2,z:-1,dimension:0,sub_chunk_count:4,payload:Buffer.alloc(0)},{dimension:0});
 assert.equal(event.type,'world.chunk.observed');assert.deepEqual(seen,[2]);assert.equal(runtime.world.snapshot().chunks,1);
 runtime.observePacket('add_player',{runtime_entity_id:44n,position:{x:3,y:64,z:4}},{dimension:0});
 assert.deepEqual(runtime.world.getEntityPosition('44'),{x:3,y:64,z:4});
 assert.equal(new GoalFollow('44',id=>runtime.world.getEntityPosition(id),2).isEnd({x:3,y:64,z:4}),true);
 const terrain={snapshot:()=>({collisionClassificationReady:true}),tile:()=> 'walkable'};
 const route=runtime.planTerrainRoute({dimension:0,terrain},{start:{x:0,y:64,z:0},goal:new GoalBlock(2,64,0)});
 assert.equal(route.status,'preview');assert.equal(route.executable,false);
 assert.equal(runtime.snapshot().integrations.plugins.readOnly,true);runtime.close();
});
test('BedrockGameplayBridge feeds normalized events after original packet handler',()=>{
 const {EventEmitter}=require('node:events');
 const {BedrockGameplayBridge}=require('../../../../scripts/bedrock-gameplay-bridge.cjs');
 const client=new EventEmitter();client.queue=()=>{};
 const runtime=createRuntimeExtensions({clock:()=>2000}),seen=[];
 runtime.events.subscribe('world.chunk.observed',event=>seen.push(event.payload.x));
 const bridge=new BedrockGameplayBridge(client,{runtimeExtensions:runtime,clock:()=>2000}).start();
 client.emit('start_game',{server_version:'1.26.60',dimension:0,player_position:{x:0,y:64,z:0},
  runtime_entity_id:1n,entity_id:1n,enable_item_stack_net_manager:false,current_tick:1n});
 client.emit('level_chunk',{x:3,z:-2,dimension:0,sub_chunk_count:4,cache_enabled:false,payload:Buffer.alloc(0)});
 assert.deepEqual(seen,[3]);assert.equal(runtime.world.snapshot().dimension,0);assert.equal(runtime.world.snapshot().chunks,1);
 bridge.stop();assert.equal(runtime.snapshot().integrations.events.closed,true);
});


test('runtime facade consumes live bridge telemetry for capability and stuck assessments',()=>{
 let now=1000;
 const runtime=createRuntimeExtensions({clock:()=>now});
 const bridge={
  closed:false,spawned:true,position:{x:4,y:64,z:9},
  movement:{capability:()=> 'ready',snapshot:()=>({capability:'ready',active:true,corrections:0,
   predictedPosition:{x:4,y:64,z:9}})},
  terrain:{snapshot:()=>({decodedSections:1,collisionClassificationReady:true})},
  inventoryLedger:{playerInventory:()=>({known:true,fresh:true,fullSnapshotFresh:true,
   registryKnown:true,unresolvedItemCount:0})},
  recipeCatalog:{snapshot:()=>({observedAt:now,ageMs:0})}
 };
 let assessment=runtime.observeBridge(bridge);
 assert.equal(assessment.capabilities.status,'ready');
 assert.equal(assessment.capabilities.canExecute,true);
 assert.equal(assessment.stuckRecovery.stuck,false);
 for(let i=0;i<4;i++){now+=1000;assessment=runtime.observeBridge(bridge);}
 assert.equal(assessment.stuckRecovery.stuck,true);
 assert.equal(assessment.stuckRecovery.executable,false);
 const snapshot=runtime.snapshot();
 assert.equal(snapshot.capabilityAssessment.status,'ready');
 assert.equal(snapshot.taskExecution.configured,false);
 assert.equal(snapshot.taskExecution.runner.emitsPackets,false);
 runtime.close();
});
