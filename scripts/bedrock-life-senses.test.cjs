'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {BedrockLifeSenses}=require('./bedrock-life-senses.cjs');
const {BedrockGameplayBridge}=require('./bedrock-gameplay-bridge.cjs');

test('life senses prioritize death, health, nearby threat and hunger from observations',()=>{
  let now=1000;
  const life=new BedrockLifeSenses({clock:()=>now});
  life.reset(0);
  const world={spawned:true,dimension:0,position:{x:0.5,y:65.62,z:0.5}};
  assert.equal(life.snapshot(world).intent,'await_goal');
  life.observeVitals({health:20,hunger:20});
  life.observeEntity({runtime_entity_id:5n,entity_type:'minecraft:zombie',
    position:{x:4,y:65,z:0}},'mob');
  assert.equal(life.snapshot(world).intent,'avoid_hostile');
  life.observeVitals({health:5});
  assert.equal(life.snapshot(world).intent,'seek_safety');
  life.observeVitals({health:0});
  assert.equal(life.snapshot(world).intent,'respawn');
  assert.equal(life.snapshot(world).executed,false);
  life.observeVitals({health:20,hunger:4});
  now+=16000;
  assert.equal(life.snapshot(world).intent,'find_food');
  assert.equal(life.snapshot(world).nearbyEntities.length,0);
});

test('unknown entity types and unknown voxel terrain never imply danger or safe walking',()=>{
  const life=new BedrockLifeSenses({clock:()=>1000});
  life.reset(0);
  assert.equal(life.observeEntity({runtime_entity_id:8n,entity_type:133,
    position:{x:1,y:65,z:2}}),false);
  assert.equal(life.snapshot({position:{x:0,y:65,z:0},spawned:true,dimension:0,
    terrain:{tile:()=> 'unknown'}}).localTerrain.unknown,25);
  assert.equal(life.snapshot({position:{x:0,y:65,z:0},spawned:true,dimension:0})
    .hostilesNearby,0);
  assert.equal(life.snapshot({position:{x:0,y:65,z:0},spawned:true,dimension:0})
    .visualFrames,false);
});

test('world bridge consumes entity and health packets without sending unauthorized actions',()=>{
  const client=new EventEmitter();
  const sent=[];
  client.queue=(name,packet)=>sent.push({name,packet});
  const senses=new BedrockLifeSenses({clock:()=>1000});
  const bridge=new BedrockGameplayBridge(client,{lifeSenses:senses,clock:()=>1000}).start();
  client.emit('start_game',{runtime_entity_id:123n,player_position:{x:0,y:65.62,z:0},
    dimension:0,current_tick:100n,movement_authority:1});
  client.emit('spawn');
  sent.length=0;
  client.emit('add_actor',{runtime_entity_id:5n,entity_type:'minecraft:creeper',
    position:{x:2,y:65,z:0}});
  client.emit('add_player',{runtime_entity_id:7n,username:'Friend',
    position:{x:1,y:65,z:1}});
  client.emit('update_attributes',{runtime_entity_id:123n,
    attributes:[{name:'minecraft:health',current:20}]});
  assert.equal(bridge.snapshot().life.hostilesNearby,1);
  assert.equal(bridge.snapshot().life.state,'threatened');
  assert.equal(bridge.snapshot().life.nearbyEntities.length,2);
  assert.deepEqual(sent,[],'observation cannot issue gameplay packets');
  client.emit('remove_actor',{entity_id:5n});
  assert.equal(bridge.snapshot().life.hostilesNearby,0);
  client.emit('change_dimension',{dimension:1});
  assert.equal(bridge.snapshot().life.nearbyEntities.length,0);
  bridge.stop();
  assert.equal(client.listenerCount('add_actor'),0);
});
