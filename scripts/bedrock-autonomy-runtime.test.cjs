'use strict';

const { existsSync } = require('node:fs');
const { join } = require('node:path');
function requireBundleModule(name) {
  const candidates = [join(__dirname, '..', name), join(__dirname, name)];
  const target = candidates.find(existsSync);
  if (!target) throw new Error(`Runtime bundle module is missing: ${name}`);
  return require(target);
}
const test=require('node:test');
const assert=require('node:assert/strict');
const {BedrockTerrainCache,parseSubchunk}=requireBundleModule('bedrock-terrain-cache.cjs');
const {createVanillaRuntimeRegistry,clearRuntimeRegistryCache}=requireBundleModule('bedrock-runtime-registry.cjs');
const {planLocalRoute}=requireBundleModule('bedrock-local-path.cjs');
const {VerifiedAutonomyRunner}=requireBundleModule('bedrock-autonomy-runner.cjs');

function vint(n){
  const out=[];do{let v=n&127;n=Math.floor(n/128);out.push(n?v|128:v);}while(n);
  return Buffer.from(out);
}
function uniform(sectionY,id){
  // Zero-bit runtime palette: the network VarInt stores the runtime ID << 1.
  return Buffer.concat([Buffer.from([9,1,(sectionY+256)%256,1]),vint(id << 1)]);
}
const air=18894,stone=3317;
function levelPacket(payload=uniform(4,air)){
  return {x:0,z:0,dimension:0,sub_chunk_count:1,cache_enabled:false,
    blobs:[],payload};
}
function terrain(){
  const terrain=new BedrockTerrainCache();
  terrain.reset(0);
  terrain.setRegistry(new Map([[air,{name:'minecraft:air',boundingBox:'empty'}],
    [stone,{name:'minecraft:stone',boundingBox:'block'}],
    [100,{name:'minecraft:lava',boundingBox:'empty'}]]));
  assert.equal(terrain.levelChunk(levelPacket()),true);
  for(let x=0;x<6;x++)for(let z=0;z<3;z++)
    terrain.updateBlock({position:{x,y:63,z},layer:0,block_runtime_id:stone},0);
  return terrain;
}
test('1.26 network v9 palette exposes known air and ground but never infers unknown',()=>{
  const t=terrain();
  assert.equal(t.blockId(0,0,64,0),air);
  assert.equal(t.blockName(0,0,64,0),'minecraft:air');
  assert.equal(t.blockId(0,0,63,0),stone);
  assert.equal(t.tile(0,0,64,0),'walkable');
  assert.equal(t.tile(0,32,64,32),'unknown');
  assert.equal(t.tile(0,0,80,0),'unknown');
  assert.equal(t.snapshot().decodedSections,1);
  t.reset(1);
  assert.equal(t.blockId(1,0,64,0),null);
});
test('cache-only and corrupt subchunks must fail closed without partial map poisoning',()=>{
  const t=terrain();
  const prior=t.snapshot().decodedSections;
  assert.equal(t.levelChunk({...levelPacket(),cache_enabled:true}),false);
  assert.equal(t.levelChunk(levelPacket(Buffer.from([9,1,4,1]))),false);
  assert.equal(t.snapshot().decodedSections,prior);
  assert.equal(t.snapshot().cacheMisses,1);
  assert.ok(t.snapshot().decodeErrors>0);
  assert.throws(()=>parseSubchunk(Buffer.from([9,1,4,0])),/unsupported_network_palette/);
  assert.equal(t.subChunk({dimension:0,origin:{x:0,y:4,z:0},entries:[{
    dx:0,dy:0,dz:0,result:'success_all_air'
  }]}),1);
  assert.equal(t.blockId(0,0,64,0),air,'all-air maps to real palette ID, not ID 0');
});
test('A* only traverses verified same-level safe tiles and avoids hazards',()=>{
  const t=terrain();
  const start={x:0.5,y:65.62,z:0.5},end={x:4.5,y:65.62,z:0.5};
  const path=planLocalRoute(t,0,start,end);
  assert.equal(path.status,'route_found');
  assert.ok(path.path.length>=5);
  assert.equal(path.executed,false);
  assert.equal(planLocalRoute(t,0,start,{x:200,y:65.62,z:200}).status,'unverified');
  t.updateBlock({position:{x:2,y:64,z:0},block_runtime_id:100,layer:0},0);
  const reroute=planLocalRoute(t,0,start,end);
  assert.equal(reroute.status,'route_found');
  assert.ok(reroute.path.some(p=>p.z!==0.5));
  assert.equal(planLocalRoute(t,0,start,{x:4.5,y:67.62,z:0.5}).status,'unverified');
});
test('vanilla registry uses state ID ranges while unknown custom and hashed states stay blocked',()=>{
  clearRuntimeRegistryCache();
  const fake={blocks:[
    {name:'air',minStateId:air,maxStateId:air,boundingBox:'empty'},
    {name:'stone',minStateId:0,maxStateId:1100,boundingBox:'block'}
  ]};
  const hashed=createVanillaRuntimeRegistry({server_version:'1.26.66.1',
    block_network_ids_are_hashes:true});
  assert.ok(hashed instanceof Map);
  assert.equal(hashed.get((-2144268767)>>>0).name,'minecraft:stone');
  // Injected minecraft-data is a synthetic unit-test fixture, not the
  // production ordered palette. Production custom registrations fail closed.
  const mapped=createVanillaRuntimeRegistry({server_version:'1.26.60.1',
    block_properties:[{name:'custom:foo'}]},()=>fake);
  assert.equal(mapped.get(air).name,'minecraft:air');
  assert.equal(mapped.get(200).boundingBox,'block');
  assert.equal(mapped.get(2000),undefined,
    'custom numeric IDs without a verified state mapping stay unknown');
  assert.equal(createVanillaRuntimeRegistry({server_version:'1.27.0'},()=>fake),null);
  clearRuntimeRegistryCache();
});
test('bounded autonomy continues from an uncontradicted local prediction when no positive ack is sent',()=>{
  let now=1000,beat,lastStepOrigin=null;
  const t=terrain();
  const point={x:.5,y:65.62,z:.5};
  let predicted={...point};
  const movement={
    busy:false,calls:0,
    capability:()=> 'ready',
    snapshot(){return {active:this.busy,predictedPosition:{...predicted}};},
    runVerifiedStep(world,target){
      this.busy=true;this.calls++;lastStepOrigin={...world.position};
      predicted={...target};return {status:'accepted'};
    },
    stop(){this.busy=false;}
  };
  const world={
    movement,terrain:t,dimension:0,position:{...point},closed:false,spawned:true,
    movementAuthority:1,lastServerPositionAt:1000,
    layerTwo:{preview:()=>({goal:'follow',status:'route_unverified',
      nextPoint:{x:2.5,y:65.62,z:.5}})},
    gameplayWorld:()=>({safetyHold:false}),
    routePlanner:planLocalRoute
  };
  const runner=new VerifiedAutonomyRunner({
    clock:()=>now,setInterval:fn=>{beat=fn;return 1;},clearInterval:()=>{}
  });
  assert.equal(runner.enable(world,{confirmed:false}).reason,'confirmation_required');
  assert.equal(runner.enable(world,{confirmed:true}).status,'accepted');
  beat();
  assert.equal(movement.calls,1);
  assert.equal(runner.snapshot().attemptedSteps,1);
  movement.busy=false;
  now+=1300;beat();
  assert.equal(runner.snapshot().active,true);
  assert.equal(runner.snapshot().serverVerifiedSteps,0);
  assert.equal(runner.snapshot().predictionSteps,1);
  const firstPredictedPosition={...predicted};
  assert.deepEqual(world.position,firstPredictedPosition);
  now+=250;beat();
  assert.equal(movement.calls,2,'the next route step starts at the predicted position');
  assert.deepEqual(lastStepOrigin,firstPredictedPosition);
  runner.stop('test_cleanup');
});

test('bounded autonomy stops when neither the server nor local physics shows progress',()=>{
  let now=1000,beat;
  const point={x:.5,y:65.62,z:.5};
  const movement={
    busy:false,capability:()=> 'ready',
    snapshot(){return {active:this.busy,predictedPosition:{...point}};},
    runVerifiedStep(){this.busy=true;return {status:'accepted'};},
    stop(){this.busy=false;}
  };
  const world={
    movement,terrain:terrain(),dimension:0,position:{...point},closed:false,spawned:true,
    movementAuthority:1,lastServerPositionAt:1000,
    layerTwo:{preview:()=>({goal:'follow',status:'route_unverified',
      nextPoint:{x:2.5,y:65.62,z:.5}})},
    gameplayWorld:()=>({safetyHold:false}),routePlanner:planLocalRoute
  };
  const runner=new VerifiedAutonomyRunner({
    clock:()=>now,setInterval:fn=>{beat=fn;return 1;},clearInterval:()=>{}
  });
  assert.equal(runner.enable(world,{confirmed:true}).status,'accepted');
  beat();movement.busy=false;now+=1300;beat();
  assert.equal(runner.snapshot().active,false);
  assert.equal(runner.snapshot().stopReason,'movement_prediction_no_progress');
  assert.equal(runner.snapshot().predictionSteps,0);
});
test('autonomy requires movement capability, verified route and safety hold',()=>{
  const t=terrain();
  const world={movement:{capability:()=> 'unavailable'},terrain:t,dimension:0,
    position:{x:.5,y:65.62,z:.5},closed:false,spawned:true,movementAuthority:1,
    gameplayWorld:()=>({safetyHold:false}),
    layerTwo:{preview:()=>({goal:'follow',status:'route_unverified',
      nextPoint:{x:2.5,y:65.62,z:.5}})},routePlanner:planLocalRoute};
  const a=new VerifiedAutonomyRunner();
  assert.equal(a.enable(world,{confirmed:true}).reason,'movement_unavailable');
  world.movement.capability=()=> 'ready';
  world.gameplayWorld=()=>({safetyHold:true});
  assert.equal(a.enable(world,{confirmed:true}).reason,'survival_safety_override');
  world.gameplayWorld=()=>({safetyHold:false});
  world.layerTwo.preview=()=>({goal:'follow',status:'awaiting_world',reason:'world_not_ready'});
  assert.equal(a.enable(world,{confirmed:true}).reason,'world_not_ready');
  assert.equal(a.snapshot().active,false);
});


test('packaged minecraft-data 1.26.60 supplies real vanilla air and stone runtime states',()=>{
  clearRuntimeRegistryCache();
  const registry=createVanillaRuntimeRegistry({engine:'1.26.60',block_properties:[]});
  assert.ok(registry instanceof Map,'pinned Bedrock registry must be loadable on Android');
  assert.equal(registry.get(18894)?.name,'minecraft:air');
  assert.equal(registry.get(3317)?.name,'minecraft:stone');
  assert.equal(registry.get(3317)?.boundingBox,'block');
  clearRuntimeRegistryCache();
});


test('continuous Follow starts in range, holds position, waits for stale targets, and resumes when target moves',()=>{
  let now=1000,beat,plan={goal:'follow',status:'at_target',distance:2.4};
  const point={x:.5,y:65.62,z:.5};
  const movement={
    busy:false,calls:0,stops:0,capability:()=> 'ready',
    snapshot(){return {active:this.busy,predictedPosition:{...point}};},
    runVerifiedStep(){this.calls++;this.busy=true;return {status:'accepted'};},
    stop(){this.stops++;this.busy=false;}
  };
  const world={
    movement,terrain:terrain(),dimension:0,position:{...point},closed:false,spawned:true,
    movementAuthority:1,lastServerPositionAt:1000,
    layerTwo:{preview:()=>plan},
    gameplayWorld:()=>({safetyHold:false}),
    routePlanner:()=>({status:'route_found',waypoint:{x:1.5,y:65.62,z:.5}})
  };
  const runner=new VerifiedAutonomyRunner({
    clock:()=>now,setInterval:fn=>{beat=fn;return 1;},clearInterval:()=>{}
  });
  assert.equal(runner.enable(world,{confirmed:true}).status,'accepted',
    'follow should start even when the target is already within the comfort radius');
  assert.equal(runner.snapshot().mode,'continuous_follow');
  beat();
  assert.equal(runner.snapshot().active,true);
  assert.equal(runner.snapshot().phase,'holding_follow_distance');
  assert.equal(movement.calls,0);
  plan={goal:'follow',status:'waiting_for_target',reason:'player_position_stale'};
  now+=250;beat();
  assert.equal(runner.snapshot().active,true,'temporary target observation loss should not terminate follow');
  assert.equal(runner.snapshot().phase,'waiting_for_target');
  plan={goal:'follow',status:'route_unverified',nextPoint:{x:1.5,y:65.62,z:.5}};
  now+=250;beat();
  assert.equal(movement.calls,1,'fresh target movement should resume route execution');
  assert.equal(runner.snapshot().active,true);
  runner.stop('test_cleanup');
});

test('continuous Follow forwards verified step-up intent to movement controller',()=>{
 let beat,received=null;const point={x:0.5,y:65.62,z:0.5};
 const movement={capability:()=> 'ready',snapshot:()=>({active:false,predictedPosition:{...point}}),
  runVerifiedStep(_w,_target,_ticks,options){received=options;return {status:'accepted'};},stop(){}};
 const world={movement,terrain:terrain(),dimension:0,position:{...point},closed:false,spawned:true,movementAuthority:1,lastServerPositionAt:1000,
  layerTwo:{preview:()=>({goal:'follow',status:'route_unverified',nextPoint:{x:2.5,y:66.62,z:0.5}})},
  gameplayWorld:()=>({safetyHold:false}),routePlanner:()=>({status:'route_found',waypoint:{x:1.5,y:66.62,z:0.5},jump:true})};
 const runner=new VerifiedAutonomyRunner({clock:()=>1000,setInterval:fn=>{beat=fn;return 1;},clearInterval:()=>{}});
 assert.equal(runner.enable(world,{confirmed:true}).status,'accepted');beat();
 assert.deepEqual(received,{jump:true});runner.stop('test_cleanup');
});

test('continuous Follow is not terminated by the finite-task time or step budget',()=>{
  let now=1000,beat;
  const point={x:.5,y:65.62,z:.5};
  const movement={capability:()=> 'ready',snapshot:()=>({active:false,predictedPosition:{...point}}),
    runVerifiedStep:()=>({status:'rejected',reason:'fixture_route_not_executed'}),stop(){}};
  const world={movement,terrain:terrain(),dimension:0,position:{...point},closed:false,spawned:true,
    movementAuthority:1,lastServerPositionAt:1000,
    layerTwo:{preview:()=>({goal:'follow',status:'at_target',distance:2})},
    gameplayWorld:()=>({safetyHold:false}),routePlanner:()=>null};
  const runner=new VerifiedAutonomyRunner({clock:()=>now,
    setInterval:fn=>{beat=fn;return 1;},clearInterval:()=>{}});
  assert.equal(runner.enable(world,{confirmed:true}).status,'accepted');
  runner.stepCount=100;
  now+=31000;
  beat();
  assert.equal(runner.snapshot().active,true);
  assert.equal(runner.snapshot().phase,'holding_follow_distance');
  runner.stop('test_cleanup');
});
