'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {BedrockGameplayBridge}=require('./bedrock-gameplay-bridge.cjs');
class Client extends EventEmitter {
  constructor(){super();this.sent=[];}
  queue(name,value){this.sent.push({name,value});}
}
const initial={runtime_entity_id:123n,player_position:{x:8.5,y:65,z:10.5},
  dimension:0,current_tick:100n,movement_authority:1};
function fixture() {
  const client=new Client();
  const called=[];
  const movement={
    stopPresence(reason){called.push('presence:'+reason);},
    stop(reason){called.push('movement:'+reason);},
    startPresence(){called.push('presence:started');}
  };
  const autonomy={stop(reason){called.push('autonomy:'+reason);}, snapshot(){return {active:false};}};
  const bridge=new BedrockGameplayBridge(client,{movement,autonomy}).start();
  client.emit('start_game',initial);
  client.emit('spawn');
  client.sent.length=0;
  return {client,bridge,called};
}
test('dead bot requests respawn once after server state 0 then action after state 1',()=>{
  const {client,bridge,called}=fixture();
  client.emit('update_attributes',{runtime_entity_id:123n,
    attributes:[{name:'minecraft:health',current:0}]});
  assert.equal(bridge.snapshot().respawnRecovery.state,'dead_waiting_for_server');
  assert.equal(bridge.spawned,false);
  assert.ok(called.includes('movement:player_died'));
  client.emit('update_attributes',{runtime_entity_id:123n,
    attributes:[{name:'minecraft:health',current:0}]});
  assert.equal(bridge.snapshot().respawnRecovery.deaths,1);
  const pos={x:12.5,y:72,z:8.5};
  client.emit('respawn',{runtime_entity_id:123n,state:0,position:pos});
  client.emit('respawn',{runtime_entity_id:123n,state:0,position:pos});
  client.emit('respawn',{runtime_entity_id:123n,state:1,position:pos});
  client.emit('respawn',{runtime_entity_id:123n,state:1,position:pos});
  assert.deepEqual(client.sent.map(x=>x.name),['respawn','player_action']);
  assert.equal(client.sent[0].value.state,2);
  assert.equal(client.sent[1].value.action,'respawn');
  assert.equal(client.sent[1].value.runtime_entity_id,123n);
  assert.equal(bridge.snapshot().respawnRecovery.state,'respawn_action_sent');
  assert.equal(bridge.spawned,false);
  client.emit('set_health',{health:20});
  assert.equal(bridge.spawned,true);
  assert.equal(bridge.snapshot().respawnRecovery.recovered,1);
  assert.equal(called.at(-1),'presence:started');
  bridge.stop();
});
test('initial join respawn still sends only traditional state-2 acknowledgement',()=>{
  const {client,bridge}=fixture();
  client.emit('respawn',{runtime_entity_id:123n,state:1,position:initial.player_position});
  assert.deepEqual(client.sent.map(x=>x.name),['respawn']);
  assert.equal(bridge.snapshot().respawnRecovery.deaths,0);
  bridge.stop();
});
test('foreign health and respawn packets never trigger self-respawn',()=>{
  const {client,bridge}=fixture();
  client.emit('update_attributes',{runtime_entity_id:999n,
    attributes:[{name:'minecraft:health',current:0}]});
  client.emit('respawn',{runtime_entity_id:999n,state:0,position:initial.player_position});
  assert.deepEqual(client.sent,[]);
  assert.equal(bridge.snapshot().respawnRecovery.state,'alive');
  bridge.stop();
});
test('death followed directly by server state 1 requests only one revival',()=>{
  const {client,bridge}=fixture();
  client.emit('set_health',{health:0});
  client.emit('respawn',{runtime_entity_id:123n,state:1,
    position:{x:0.5,y:66,z:0.5}});
  assert.deepEqual(client.sent.map(x=>x.name),['respawn','player_action']);
  assert.equal(bridge.snapshot().respawnRecovery.requests,1);
  assert.equal(bridge.snapshot().respawnRecovery.actionRequests,1);
  bridge.stop();
});
test('pinned Bedrock 1.26.60 codec serializes respawn player action',()=>{
  const {createSerializer}=require('bedrock-protocol/src/transforms/serializer');
  const codec=createSerializer('1.26.60');
  const pos={x:12,y:72,z:8};
  const encoded=codec.createPacketBuffer({name:'player_action',params:{
    runtime_entity_id:123n,action:'respawn',position:pos,result_position:pos,face:0
  }});
  assert.ok(Buffer.isBuffer(encoded)&&encoded.length>10);
});
