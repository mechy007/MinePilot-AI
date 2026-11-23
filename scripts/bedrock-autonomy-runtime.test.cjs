'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {BedrockTerrainCache,parseSubchunk}=require('../bedrock-terrain-cache.cjs');
const {createVanillaRuntimeRegistry,clearRuntimeRegistryCache}=require('../bedrock-runtime-registry.cjs');
const {planLocalRoute}=require('../bedrock-local-path.cjs');
const {VerifiedAutonomyRunner}=require('../bedrock-autonomy-runner.cjs');

function vint(n){
  const out=[];do{let v=n&127;n=Math.floor(n/128);out.push(n?v|128:v);}while(n);
  return Buffer.from(out);
}
function uniform(sectionY,id){
  return Buffer.concat([Buffer.from([9,1,(sectionY+256)%256,1,1]),vint(id)]);
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
  assert.equal(t.tile(0,0,68,0),'unknown');
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
test('vanilla registry uses state ID ranges and declines custom server palette',()=>{
  clearRuntimeRegistryCache();
  const fake={blocks:[
    {name:'air',minStateId:air,maxStateId:air,boundingBox:'empty'},
    {name:'stone',minStateId:0,maxStateId:1100,boundingBox:'block'}
  ]};
  assert.equal(createVanillaRuntimeRegistry({engine:'1.26.60.1',
    block_properties:[{name:'custom:foo'}]},()=>fake),null);
  const mapped=createVanillaRuntimeRegistry({engine:'1.26.60.1',
    block_properties:[]},()=>fake);
  assert.equal(mapped.get(air).name,'minecraft:air');
  assert.equal(mapped.get(200).boundingBox,'block');
  assert.equal(createVanillaRuntimeRegistry({engine:'1.27.0'},()=>fake),null);
  clearRuntimeRegistryCache();
});
test('bounded autonomy performs a real step but never chains without host progress',()=>{
  let now=1000,beat;
  const movement={
    busy:false,calls:0,
    capability:()=> 'experimental',
    snapshot(){return {active:this.busy};},
    runVerifiedStep(){this.busy=true;this.calls++;return {status:'accepted'};},
    stop(){this.busy=false;}
  };
  const t=terrain();
  const point={x:.5,y:65.62,z:.5};
  const world={
    movement,terrain,dimension:0,position:point,closed:false,spawned:true,
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
  now+=3500;beat();
  assert.equal(movement.calls,1,'no blind second step while server position unchanged');
  now+=600;beat();
  assert.equal(runner.snapshot().active,false);
  assert.equal(runner.snapshot().stopReason,'server_movement_not_confirmed');
  assert.equal(runner.snapshot().serverVerifiedSteps,0);
});
test('autonomy requires movement capability, verified route and safety hold',()=>{
  const t=terrain();
  const world={movement:{capability:()=> 'unavailable'},terrain:t,dimension:0,
    position:{x:.5,y:65.62,z:.5},closed:false,spawned:true,movementAuthority:1,
    gameplayWorld:()=>({safetyHold:false}),
    layerTwo:{preview:()=>({goal:'follow',status:'route_unverified',
      nextPoint:{x:2.5,y:65.62,z:.5}})},routePlanner:planLocalRoute};
  const a=new VerifiedAutonomyRunner();
  assert.equal(a.enable(world,{confirmed:true}).reason,'experimental_movement_not_enabled');
  world.movement.capability=()=> 'experimental';
  world.gameplayWorld=()=>({safetyHold:true});
  assert.equal(a.enable(world,{confirmed:true}).reason,'survival_safety_override');
  world.gameplayWorld=()=>({safetyHold:false});
  world.layerTwo.preview=()=>({goal:'follow',status:'waiting_for_target'});
  assert.equal(a.enable(world,{confirmed:true}).reason,'route_not_ready');
  assert.equal(a.snapshot().active,false);
});
