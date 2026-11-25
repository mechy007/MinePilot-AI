'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {BedrockGameplayAgent}=require('./bedrock-gameplay-agent.cjs');
const {MinePilotIntelligence}=require('./bedrock-intelligence-core.cjs');
const {BedrockGameplayBridge}=require('./bedrock-gameplay-bridge.cjs');
const {EventEmitter}=require('node:events');

function fixture() {
  let now=1000,enabled=true,active=false,muted=false;
  let ticks=0,stopCount=0,foodPlans=0;
  let callback;
  const sent=[];
  let life={state:'exploring_ready',health:20,hunger:20,air:20,
    localTerrain:{unknown:0,hazard:0,status:'observed'},nearbyEntities:[]};
  const clock=()=>now;
  const agent=new BedrockGameplayAgent({
    clock,setInterval(fn){callback=fn;return 1;},
    clearInterval(){callback=null;}
  });
  const intelligence=new MinePilotIntelligence({clock});
  const movement={
    capability(){return enabled?'experimental':'unavailable';},
    snapshot(){return {active};},
    runVerifiedStep(world,point,ticks){
      assert.ok(Math.hypot(point.x-world.position.x,point.z-world.position.z)<=2.1);
      sent.push({point:{...point},ticks});active=true;
      return {status:'accepted',reason:'queued_not_verified'};
    },
    stop(reason){stopCount++;active=false;},
  };
  const layerTwo={
    chosen:null,
    preview(){
      return this.chosen??{status:'idle',goal:null};
    },
    follow(name){
      if(name!=='friend')return {status:'rejected',reason:'player_not_visible'};
      this.chosen={status:'route_unverified',goal:'follow',
        nextPoint:{x:9.5,y:65.62,z:8.5}};
      return {status:'accepted'};
    },
    returnHome(){
      this.chosen={status:'route_unverified',goal:'return',
        nextPoint:{x:8.5,y:65.62,z:7.5}};
      return {status:'accepted'};
    }
  };
  const layerThree={
    preview(){return {status:'idle'};}
  };
  const world={
    closed:false,spawned:true,dimension:0,
    self:'123',position:{x:8.5,y:65.62,z:8.5},
    respawnRecovery:{state:'alive'},
    movementAuthority:1,serverTick:100n,
    lastServerPositionAt:now,corrections:0,receivedChunks:new Map([['a',true]]),
    terrain:{
      snapshot(){return {collisionClassificationReady:true,decodedSections:1};},
      tile(d,x,y,z){return muted?'unknown':'walkable';}
    },
    routePlanner(terrain,dim,start,target){
      if(muted)return {status:'unverified',reason:'unverified_terrain'};
      const x=target.x-start.x,z=target.z-start.z;
      const dist=Math.hypot(x,z);
      if(dist<0.01)return {status:'unverified',reason:'at_target'};
      const waypoint={x:start.x+x/dist*Math.min(0.95,dist),
        y:start.y,z:start.z+z/dist*Math.min(0.95,dist)};
      return {status:'route_found',waypoint,path:[{...start},waypoint]};
    },
    movement,
    layerTwo,layerThree,
    layerFour:{planFood(){foodPlans++;return {status:'accepted'};}},
    blockBreaker:{snapshot(){return {active:false};}},
    autonomy:{snapshot(){return {active:false};}},
    lifeSenses:{snapshot(){return life;}},
    intelligence,
    gameplayWorld(){return {spawned:true,position:this.position,dimension:0,
      chunks:1,safetyHold:false};}
  };
  world.intelligenceTick=()=>{
    const age=now-world.lastServerPositionAt;
    return intelligence.decide({
      life,position:world.position,dimension:world.dimension,spawned:world.spawned,
      respawnState:world.respawnRecovery.state,positionAgeMs:age,
      positionUsable:age>=0&&age<=7000,idlePositionAnchor:false,
      terrainReady:world.terrain.snapshot().decodedSections>0,
      safetyHold:world.gameplayWorld().safetyHold
    });
  };
  return {agent,world,sent,intelligence,layerTwo,layerThree,
    tick(){agent.pulse();ticks++;},
    changeLife(next){life={...life,...next};},
    setTerrainUnknown(value){muted=value;},
    setMovementEnabled(value){enabled=value;},
    movementEnds(){active=false;},
    advance(ms){now+=ms;},
    updatePosition(point){
      world.position={...point};world.lastServerPositionAt=now;
    },
    get callbacks(){return callback;},
    get stopCount(){return stopCount;},
    get foodPlans(){return foodPlans;}
  };
}

test('agent is opt-in and cannot run without experimental movement, live world, and verified terrain',()=>{
  const f=fixture();
  assert.equal(f.agent.start(f.world,{goal:'explore'}).reason,'confirmation_required');
  assert.equal(f.agent.start(f.world,{confirmed:true,goal:'fight'}).reason,'unsupported_goal');
  f.setMovementEnabled(false);
  assert.equal(f.agent.start(f.world,{confirmed:true,goal:'explore'}).reason,
    'experimental_movement_not_enabled');
  f.setMovementEnabled(true);
  f.world.autonomy.snapshot=()=>({active:true});
  assert.equal(f.agent.start(f.world,{confirmed:true,goal:'explore'}).reason,
    'follow_autonomy_busy');
  f.world.autonomy.snapshot=()=>({active:false});
  assert.equal(f.agent.start(f.world,{confirmed:true,goal:'explore'}).status,'accepted');
  assert.equal(f.agent.snapshot().active,true);
  assert.equal(f.intelligence.snapshot().goal,'explore');
  f.agent.stop();
  assert.equal(f.agent.snapshot().active,false);
  assert.equal(f.intelligence.snapshot().goal,'standby');
});
test('observe-plan-move-verify: queued movement is never claimed as server-confirmed',()=>{
  const f=fixture();
  f.agent.start(f.world,{confirmed:true,goal:'explore'});
  f.tick();
  assert.equal(f.sent.length,1);
  assert.equal(f.agent.snapshot().attemptedSteps,1);
  assert.equal(f.agent.snapshot().serverVerifiedSteps,0);
  f.tick();
  assert.equal(f.sent.length,1,'no overlapping movement actions');
  f.movementEnds();
  f.advance(200);
  f.tick();
  assert.equal(f.agent.snapshot().serverVerifiedSteps,0,
    'no new authoritative server position');
  const goal=f.agent.awaiting.target,from=f.agent.awaiting.from;
  f.advance(300);
  f.updatePosition({x:from.x+(goal.x-from.x)*0.5,y:from.y,
    z:from.z+(goal.z-from.z)*0.5});
  f.tick();
  assert.equal(f.agent.snapshot().serverVerifiedSteps,1);
  assert.equal(f.intelligence.snapshot().outcomes.verified,1);
  assert.equal(f.agent.snapshot().phase,'verified');
  assert.equal(f.sent.length,1);
});
test('unconfirmed movement times out twice and stops without uncontrolled retrying',()=>{
  const f=fixture();
  f.agent.start(f.world,{confirmed:true,goal:'explore'});
  f.tick();f.movementEnds();
  f.advance(4600);f.tick();
  assert.equal(f.agent.snapshot().failures,1);
  f.advance(1100);f.world.lastServerPositionAt+=5100;
  f.tick();
  assert.equal(f.sent.length,2);
  f.movementEnds();
  f.advance(4600);f.tick();
  assert.equal(f.agent.snapshot().active,false);
  assert.equal(f.agent.snapshot().reason,'server_movement_not_confirmed');
  assert.equal(f.agent.snapshot().failures,2);
});
test('unknown terrain, missing food interaction and stale state never emit movement',()=>{
  const f=fixture();
  f.agent.start(f.world,{confirmed:true,goal:'explore'});
  f.setTerrainUnknown(true);f.tick();
  assert.equal(f.agent.snapshot().phase,'paused');
  assert.equal(f.sent.length,0);
  f.setTerrainUnknown(false);
  f.changeLife({hunger:2});
  f.tick();
  assert.equal(f.sent.length,0);
  assert.equal(f.agent.snapshot().reason,'low_hunger_requires_verified_food_interaction');
  assert.equal(f.foodPlans,1);
  f.advance(8000);
  f.tick();
  assert.equal(f.agent.snapshot().active,false);
  assert.equal(f.agent.snapshot().reason,'server_position_stale');
});
test('recognized hostile chooses verified retreat, never attacks, unknown terrain blocks retreat',()=>{
  const f=fixture();
  f.agent.start(f.world,{confirmed:true,goal:'explore'});
  f.changeLife({nearbyEntities:[{hostile:true,distance:2,
    position:{x:10.5,y:65,z:8.5}}]});
  f.tick();
  assert.equal(f.sent.length,1);
  assert.ok(f.sent[0].point.x<8.5,'retreats away from hostile to west');
  assert.equal(f.agent.snapshot().lastPlan.kind,'retreat');
  const g=fixture();
  g.agent.start(g.world,{confirmed:true,goal:'explore'});
  g.setTerrainUnknown(true);
  g.changeLife({nearbyEntities:[{hostile:true,distance:2,
    position:{x:10.5,y:65,z:8.5}}]});
  g.tick();
  assert.equal(g.sent.length,0);
  assert.equal(g.agent.snapshot().reason,'no_verified_retreat_from_hostile');
});
test('follow/return/gather require explicit prior goal or identifiable player and verify path',()=>{
  const f=fixture();
  assert.equal(f.agent.start(f.world,{confirmed:true,goal:'follow'}).reason,
    'select_follow_player_first');
  assert.equal(f.agent.start(f.world,{confirmed:true,goal:'follow',playerName:'wrong'}).reason,
    'player_not_visible');
  assert.equal(f.agent.start(f.world,{confirmed:true,goal:'follow',playerName:'friend'}).status,
    'accepted');
  f.tick();
  assert.equal(f.sent.length,1);
  f.agent.stop();
  const g=fixture();
  assert.equal(g.agent.start(g.world,{confirmed:true,goal:'return_home'}).status,
    'accepted');
  g.tick();assert.equal(g.sent.length,1);
  const h=fixture();
  assert.equal(h.agent.start(h.world,{confirmed:true,goal:'gather'}).reason,
    'select_observed_item_goal_first');
  h.layerThree.preview=()=>({status:'waiting_for_item',itemName:'minecraft:apple',reason:'no_matching_drop_observed'});
  assert.equal(h.agent.start(h.world,{confirmed:true,goal:'gather'}).status,'accepted');
  h.tick();
  assert.equal(h.agent.snapshot().reason,'no_matching_drop_observed');
  assert.equal(h.sent.length,0);
  h.layerThree.preview=()=>({status:'observed_inventory_increase',
    itemName:'minecraft:apple'});
  h.tick();
  assert.equal(h.agent.snapshot().active,false);
  assert.equal(h.agent.snapshot().reason,'server_confirmed_item_pickup');
});
test('change of dimension, death and authority loss stop the agent and free interval',()=>{
  const f=fixture();
  f.agent.start(f.world,{confirmed:true,goal:'explore'});
  assert.ok(f.callbacks);
  f.world.dimension=1;
  f.tick();
  assert.equal(f.agent.snapshot().active,false);
  assert.equal(f.callbacks,null);
  const dead=fixture();
  dead.agent.start(dead.world,{confirmed:true,goal:'explore'});
  dead.world.respawnRecovery.state='dead_waiting_for_server';
  dead.tick();
  assert.equal(dead.agent.snapshot().reason,'world_or_respawn_not_ready');
});
test('session bridge command rejects unconfirmed start and stops independent agent on session close',()=>{
  const client=new EventEmitter();
  client.queue=()=>{};
  const f=fixture();
  const bridge=new BedrockGameplayBridge(client,{
    gameplayAgent:f.agent,intelligence:f.intelligence,clock:()=>1000
  }).start();
  assert.equal(bridge.execute({version:'minepilot.gameplay.v1',requestId:'one',
    action:'agent_start',goal:'explore'}).reason,'confirmation_required');
  const snap=bridge.snapshot();
  assert.equal(snap.gameplayAgent.active,false);
  assert.equal(snap.gameplayAgent.serverVerifiedSteps,0);
  bridge.stop();
});

test('new hostile preempts an unconfirmed move before selecting a verified retreat',()=>{
  const f=fixture();
  f.agent.start(f.world,{confirmed:true,goal:'explore'});
  f.tick();
  assert.equal(f.agent.snapshot().attemptedSteps,1);
  assert.equal(f.agent.snapshot().serverVerifiedSteps,0);
  f.changeLife({nearbyEntities:[{hostile:true,distance:2,
    position:{x:10.5,y:65,z:8.5}}]});
  f.tick();
  assert.equal(f.agent.snapshot().phase,'evading');
  assert.equal(f.agent.awaiting,null);
  assert.ok(f.stopCount>=1,'pending movement pulse was interrupted');
  assert.equal(f.agent.snapshot().serverVerifiedSteps,0,
    'preempted movement must not count as verified');
  f.advance(300);
  f.tick();
  assert.equal(f.sent.length,2);
  assert.equal(f.agent.snapshot().lastPlan.kind,'retreat');
  f.agent.stop();
});


test('goto accepts only a nearby target with a verified route and verifies server progress', () => {
  const f=fixture();
  const target={x:10,y:65.62,z:8.5};
  assert.equal(f.agent.start(f.world,{goal:'goto',targetPosition:target}).reason,'confirmation_required');
  assert.equal(f.agent.start(f.world,{confirmed:true,goal:'goto',targetPosition:{x:40,y:65.62,z:8.5}}).reason,
    'goto_target_must_be_within_16_blocks');
  assert.equal(f.agent.start(f.world,{confirmed:true,goal:'goto',targetPosition:target}).status,'accepted');
  assert.deepEqual(f.agent.snapshot().targetPosition,target);
  f.tick();
  assert.equal(f.sent.length,1);
  const pending=f.agent.awaiting, from=pending.from, waypoint=pending.target;
  f.movementEnds();f.advance(200);
  f.updatePosition({x:from.x+(waypoint.x-from.x)*0.8,y:from.y,
    z:from.z+(waypoint.z-from.z)*0.8});
  f.tick();
  assert.equal(f.agent.snapshot().serverVerifiedSteps,1);
  assert.equal(f.agent.snapshot().active,true);
  f.agent.stop();
  assert.equal(f.agent.snapshot().targetPosition,null);
});

test('gameplay agent follows intelligence intent and fails closed when the selected goal disagrees',()=>{
  const f=fixture();
  f.agent.start(f.world,{confirmed:true,goal:'explore'});
  f.intelligence.setGoal('goto');
  f.tick();
  assert.equal(f.sent.length,0);
  assert.equal(f.agent.snapshot().reason,'intelligence_goal_directive_mismatch');
  assert.equal(f.agent.snapshot().intelligenceDirective.action,'go_to_position');
});

test('critical air is surfaced by intelligence and blocks ordinary exploration',()=>{
  const f=fixture();
  f.agent.start(f.world,{confirmed:true,goal:'explore'});
  f.changeLife({air:3});
  f.tick();
  assert.equal(f.sent.length,0);
  assert.equal(f.intelligence.snapshot().action,'seek_safety');
  assert.equal(f.intelligence.snapshot().reason,'critical_air_supply');
  assert.equal(f.agent.snapshot().reason,'critical_vitals_wait_for_safe_recovery');
});
