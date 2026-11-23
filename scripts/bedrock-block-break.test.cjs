'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {BedrockBlockBreakExecutor}=require('../bedrock-block-break.cjs');
const {BedrockTerrainCache}=require('../bedrock-terrain-cache.cjs');
const {ExperimentalPlayerInput}=require('../bedrock-player-input.cjs');
function fixture(){
  let now=1000,pulse;
  const packets=[];
  const client={queue:(packet,value)=>packets.push({packet,value})};
  const blockBreaker=new BedrockBlockBreakExecutor({clock:()=>now});
  const movement=new ExperimentalPlayerInput(client,false,{
    clock:()=>now,presenceEnabled:true,blockExecutor:blockBreaker,
    setInterval:fn=>{pulse=fn;return 1;},clearInterval:()=>{}
  });
  const terrain=new BedrockTerrainCache();
  terrain.reset(0);
  terrain.setRegistry(new Map([[18894,{name:'minecraft:air',boundingBox:'empty'}],
    [3317,{name:'minecraft:stone',boundingBox:'block'}]]));
  terrain.updateBlock({position:{x:0,y:63,z:0},layer:0,
    block_runtime_id:3317},0);
  const world={movement,terrain,dimension:0,position:{x:.5,y:65.62,z:.5},
    movementAuthority:1,serverTick:100n,self:'123',spawned:true,closed:false,
    receivedChunks:new Map([['x',1000]]),lastServerPositionAt:now,
    gameplayWorld:()=>({safetyHold:false})};
  return {client,packets,movement,terrain,blockBreaker,world,
    pulse:()=>{now+=50;pulse()},now:()=>now};
}
test('block-break requests must be confirmed, within range and mapped to known solid blocks',()=>{
  const f=fixture();
  assert.equal(f.movement.startPresence(f.world),true);
  assert.equal(f.blockBreaker.start(f.world,{x:0,y:63,z:0},false).reason,'confirmation_required');
  assert.equal(f.blockBreaker.start(f.world,{x:10,y:63,z:0},true).reason,'target_out_of_reach');
  assert.equal(f.blockBreaker.start(f.world,{x:1,y:63,z:0},true).reason,'target_not_verified_breakable');
  assert.equal(f.blockBreaker.start(f.world,{x:0,y:63,z:0},true).status,'accepted');
  assert.equal(f.blockBreaker.start(f.world,{x:0,y:63,z:0},true).reason,'block_action_busy');
  f.movement.stopPresence();
});
test('block break shares neutral PlayerAuthInput ticks and serializes each optional block action',()=>{
  const f=fixture();
  const {createSerializer}=require('bedrock-protocol/src/transforms/serializer');
  const codec=createSerializer('1.26.60');
  f.movement.startPresence(f.world);
  assert.equal(f.blockBreaker.start(f.world,{x:0,y:63,z:0},true).status,'accepted');
  for(let i=0;i<30;i++)f.pulse();
  const actions=f.packets.filter(p=>p.value.block_action);
  assert.equal(actions.length,26);
  assert.equal(actions[0].value.block_action[0].action,'start_break');
  assert.equal(actions.at(-1).value.block_action[0].action,'stop_break');
  assert.ok(actions.every(p=>p.value.input_data.includes(35)));
  assert.ok(f.packets.every((p,i)=>i===0||p.value.tick>f.packets[i-1].value.tick));
  for(const p of [actions[0],actions[1],actions.at(-1)]){
    const encoded=codec.createPacketBuffer({name:p.packet,params:p.value});
    assert.ok(Buffer.isBuffer(encoded)&&encoded.length>15);
  }
  assert.equal(f.blockBreaker.snapshot().status,'in_progress');
  assert.equal(f.blockBreaker.snapshot().serverChanged,false);
  f.blockBreaker.observedBlock({position:{x:0,y:63,z:0},block_runtime_id:3317},0);
  assert.equal(f.blockBreaker.snapshot().status,'in_progress');
  f.blockBreaker.observedBlock({position:{x:0,y:63,z:0},block_runtime_id:18894},0);
  assert.equal(f.blockBreaker.snapshot().status,'observed');
  assert.equal(f.blockBreaker.snapshot().serverChanged,true);
  assert.equal(f.blockBreaker.snapshot().reason,'server_block_changed_causality_unverified');
  f.movement.stopPresence();
});
test('block break times out and is cancelled on authority/session loss',()=>{
  const f=fixture();
  f.movement.startPresence(f.world);
  f.blockBreaker.start(f.world,{x:0,y:63,z:0},true);
  f.pulse();
  f.world.movementAuthority=0;
  f.pulse();
  assert.equal(f.blockBreaker.snapshot().active,false);
  assert.equal(f.blockBreaker.snapshot().status,'stopped');
  assert.equal(f.movement.snapshot().presenceActive,false);
});
