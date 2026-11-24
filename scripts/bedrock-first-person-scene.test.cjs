'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {buildFirstPersonScene}=require('./bedrock-first-person-scene.cjs');
const {BedrockGameplayBridge}=require('./bedrock-gameplay-bridge.cjs');
const {BedrockTerrainCache}=require('./bedrock-terrain-cache.cjs');
const world=()=>({
  closed:false,spawned:true,dimension:0,
  position:{x:0.5,y:65,z:0.5},yaw:0,pitch:10,
  respawnRecovery:{state:'alive'},terrain:null
});
test('first-person view never invents chunks, blocks or an observed camera rotation',()=>{
  const w=world();
  assert.equal(buildFirstPersonScene(w).available,false);
  w.terrain={blockName:()=>null};
  assert.equal(buildFirstPersonScene(w).available,true);
  assert.deepEqual(buildFirstPersonScene(w).cubes,[]);
  w.yaw=null;
  assert.equal(buildFirstPersonScene(w).reason,'camera_rotation_unobserved');
  w.yaw=0;w.respawnRecovery.state='dead_waiting_for_server';
  assert.equal(buildFirstPersonScene(w).available,false);
});
test('renders only registry-decoded voxel positions; capped scene and safe reset',()=>{
  const terrain=new BedrockTerrainCache();terrain.reset(0);
  terrain.setRegistry(new Map([
    [0,{name:'minecraft:air'}],
    [1,{name:'minecraft:stone',boundingBox:'block'}],
    [2,{name:'minecraft:oak_log',boundingBox:'block'}]
  ]));
  const blocks=new Uint32Array(4096);blocks[0]=2;
  terrain.store(0,0,0,4,blocks);
  const w=world();w.position={x:0.5,y:64,z:0.5};w.terrain=terrain;
  const scene=buildFirstPersonScene(w);
  assert.equal(scene.available,true);
  assert.ok(scene.cubes.some(b=>b[3]===3),'observed oak log');
  assert.equal(scene.entities.length,0);
  assert.ok(scene.cubes.length<=144);
  assert.equal(scene.yaw,0);
  assert.equal(scene.pitch,10);
  terrain.reset(1);
  assert.equal(buildFirstPersonScene(w).cubes.length,0,
    'previous dimension blocks never remain visible');
});
test('gameplay snapshot publishes camera scene from server packet position, not guessed footage',()=>{
  const client=new EventEmitter();
  client.queue=()=>{};
  const terrain=new BedrockTerrainCache();
  const bridge=new BedrockGameplayBridge(client,{terrain}).start();
  client.emit('start_game',{
    runtime_entity_id:123n,player_position:{x:0.5,y:64,z:0.5},
    rotation:{x:9,z:180},current_tick:100n,dimension:0
  });
  client.emit('spawn');
  assert.equal(bridge.snapshot().firstPerson.available,true);
  assert.equal(bridge.snapshot().firstPerson.yaw,180);
  assert.deepEqual(bridge.snapshot().firstPerson.cubes,[]);
  client.emit('change_dimension',{dimension:1});
  assert.equal(bridge.snapshot().firstPerson.available,false);
  bridge.stop();
});
