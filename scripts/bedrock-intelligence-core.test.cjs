'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {MinePilotIntelligence}=require('./bedrock-intelligence-core.cjs');
const {BedrockGameplayBridge}=require('./bedrock-gameplay-bridge.cjs');
const {BedrockLifeSenses}=require('./bedrock-life-senses.cjs');

function obs(overrides={}) {
  return {
    spawned:true,dimension:0,position:{x:12,y:65,z:5},
    positionAgeMs:100,respawnState:'alive',terrainReady:true,
    safetyHold:false,life:{health:20,hunger:20,
      localTerrain:{status:'observed',unknown:0,hazard:0},
      nearbyEntities:[]},...overrides
  };
}
test('intelligence chooses death, stale packet state, low health, threat, hunger, and selected goal in priority order',()=>{
  const brain=new MinePilotIntelligence({clock:()=>100});
  brain.reset(0);
  assert.equal(brain.decide(obs({spawned:false})).action,'await_respawn');
  assert.equal(brain.decide(obs({positionAgeMs:9000})).action,'observe');
  assert.equal(brain.snapshot().reason,'world_state_stale');
  brain.setGoal('follow');
  assert.equal(brain.decide(obs()).action,'follow_player');
  assert.equal(brain.snapshot().execution,'recommendation_only');
  assert.equal(brain.snapshot().candidates[0].allowed,false);
  assert.equal(brain.decide(obs({life:{health:20,hunger:3,
    nearbyEntities:[],localTerrain:{unknown:0,hazard:0,status:'observed'}}})).action,'find_food');
  assert.equal(brain.decide(obs({life:{health:20,hunger:20,
    nearbyEntities:[{hostile:true,distance:5}],localTerrain:{unknown:0,hazard:0,status:'observed'}}})).action,'avoid_threat');
  assert.equal(brain.decide(obs({life:{health:4,hunger:3,
    nearbyEntities:[{hostile:true,distance:3}],localTerrain:{unknown:0,hazard:0,status:'observed'}}})).action,'seek_safety');
  assert.equal(brain.decide(obs({respawnState:'dead_waiting_for_server'})).action,'await_respawn');
});
test('idle spawn anchor is usable for previews but never labeled server-verified',()=>{
  const brain=new MinePilotIntelligence({clock:()=>100});
  brain.reset(0);
  const snapshot=brain.decide(obs({
    positionAgeMs:12000,
    positionUsable:true,
    idlePositionAnchor:true
  }));
  assert.equal(snapshot.action,'observe');
  assert.equal(snapshot.positionUsable,true);
  assert.equal(snapshot.positionMode,'idle_spawn_anchor');
  assert.equal(snapshot.verifiedWorld,false);
  assert.equal(brain.decide(obs({
    positionAgeMs:12000,
    positionUsable:false,
    idlePositionAnchor:false
  })).reason,'world_state_stale');
});

test('movement input invalidates even a numerically recent server position timestamp',()=>{
  const brain=new MinePilotIntelligence({clock:()=>100});
  brain.reset(0);
  const snapshot=brain.decide(obs({
    positionAgeMs:100,
    positionUsable:false,
    idlePositionAnchor:false
  }));
  assert.equal(snapshot.positionMode,'stale');
  assert.equal(snapshot.positionUsable,false);
  assert.equal(snapshot.verifiedWorld,false);
  assert.equal(snapshot.reason,'world_state_stale');
});

test('memory, history, and decisions remain bounded and reset across dimensions',()=>{
  let t=100;
  const brain=new MinePilotIntelligence({clock:()=>t++});
  brain.reset(0);
  assert.equal(brain.setGoal('invented').status,'rejected');
  for(let i=0;i<180;i++) {
    brain.decide(obs({position:{x:4*i,y:65,z:0},life:{
      health:i%2?20:2,hunger:20,nearbyEntities:[],
      localTerrain:{unknown:25,hazard:0,status:'partial'}
    }}));
  }
  assert.ok(brain.snapshot().memoryCells<=64);
  assert.ok(brain.snapshot().history.length<=12);
  assert.ok(brain.history.length<=32);
  brain.reset(1);
  assert.equal(brain.snapshot().memoryCells,0);
  assert.equal(brain.snapshot().goal,'standby');
  assert.equal(brain.snapshot().decisionCount,0);
});
test('threat stop is one-shot until priority changes, with no emitted gameplay command',()=>{
  const brain=new MinePilotIntelligence({clock:()=>1000});
  brain.reset(0);
  brain.decide(obs({life:{health:20,hunger:20,
    nearbyEntities:[{hostile:true,distance:4}],localTerrain:{unknown:25,hazard:0,status:'partial'}}}));
  assert.equal(brain.shouldEmergencyStop(),true);
  assert.equal(brain.shouldEmergencyStop(),false);
  brain.decide(obs({life:{health:20,hunger:20,
    nearbyEntities:[],localTerrain:{unknown:25,hazard:0,status:'partial'}}}));
  assert.equal(brain.shouldEmergencyStop(),false);
  brain.decide(obs({life:{health:20,hunger:20,
    nearbyEntities:[{hostile:true,distance:4}],localTerrain:{unknown:25,hazard:0,status:'partial'}}}));
  // Back-to-back same threat should not cause repeated movement commands.
  assert.equal(brain.shouldEmergencyStop(),false);
});
test('Bedrock session bridge presents real intelligence status and stops active autonomy on observed danger',()=>{
  const client=new EventEmitter();
  const commands=[];client.queue=(name,data)=>commands.push(name);
  const stopped=[];
  const movement={stop(reason){stopped.push(reason);},stopPresence(){}};
  const autonomy={snapshot(){return {active:true,verifiedSteps:0};},
    stop(reason){stopped.push('autonomy:'+reason);}};
  const life=new BedrockLifeSenses({clock:()=>1000});
  const brain=new MinePilotIntelligence({clock:()=>1000});
  const bridge=new BedrockGameplayBridge(client,{
    movement,autonomy,lifeSenses:life,intelligence:brain,clock:()=>1000
  }).start();
  client.emit('start_game',{runtime_entity_id:123n,
    player_position:{x:1,y:65,z:1},dimension:0,rotation:{x:0,z:0},
    current_tick:100n,movement_authority:1});
  client.emit('spawn');
  client.emit('level_chunk',{x:0,z:0,dimension:0});
  commands.length=0;stopped.length=0;
  client.emit('update_attributes',{runtime_entity_id:123n,
    attributes:[{name:'minecraft:health',current:20}]});
  client.emit('add_actor',{runtime_entity_id:100n,
    entity_type:'minecraft:creeper',position:{x:3,y:65,z:1}});
  // Status reads are pure. The explicit control tick owns decisions and stops.
  let snap=bridge.snapshot();
  assert.equal(snap.intelligence.action,'observe');
  assert.deepEqual(stopped,[]);
  bridge.tickControlPlane();
  snap=bridge.snapshot();
  assert.equal(snap.intelligence.action,'avoid_threat');
  assert.deepEqual(stopped,['autonomy:intelligence_safety_stop','intelligence_safety_stop']);
  assert.deepEqual(commands,[],'intelligence never performs unsolicited network input');
  bridge.snapshot();
  assert.equal(stopped.length,2,'status refresh does not repeat a control action');
  bridge.tickControlPlane();
  assert.equal(stopped.length,2,'unchanged threat does not trigger a repeated emergency stop');
  bridge.stop();
});


test('bounded goto is a recognized intelligence goal without granting autonomous privileges', () => {
  const brain = new MinePilotIntelligence({ clock: () => 1000 });
  assert.equal(brain.setGoal('goto').status, 'accepted');
  assert.equal(brain.snapshot().goal, 'goto');
  assert.equal(brain.setGoal('standby').status, 'accepted');
});
