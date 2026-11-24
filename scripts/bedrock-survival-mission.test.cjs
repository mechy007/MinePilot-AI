'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {BedrockGameplayAgent}=require('./bedrock-gameplay-agent.cjs');
const {MinePilotIntelligence}=require('./bedrock-intelligence-core.cjs');
const {gameplaySkillManifest}=require('./bedrock-skill-manifest.cjs');
const {BedrockGameplayBridge}=require('./bedrock-gameplay-bridge.cjs');
const {EventEmitter}=require('node:events');

function setup(){
  let now=1000,life={state:'exploring_ready',health:20,hunger:20,air:20,
    localTerrain:{status:'observed',unknown:0,hazard:0},nearbyEntities:[]};
  let selected=null,collected=false,cancelled=0,foodPlans=0;
  let count=0;
  const brain=new MinePilotIntelligence({clock:()=>now});
  const agent=new BedrockGameplayAgent({
    clock:()=>now,setInterval(){return 1;},clearInterval(){}
  });
  const world={
    clock:()=>now,closed:false,spawned:true,position:{x:0.5,y:65.62,z:0.5},
    dimension:0,serverTick:100n,movementAuthority:1,lastServerPositionAt:1000,
    respawnRecovery:{state:'alive'},corrections:0,receivedChunks:new Map([['a',1]]),
    terrain:{snapshot(){return {collisionClassificationReady:true,decodedSections:2};},
      tile(){return 'walkable';}},
    routePlanner(terrain,dim,from,to){
      const dx=to.x-from.x,dz=to.z-from.z;
      const d=Math.hypot(dx,dz);
      if(!d)return {status:'unverified',reason:'at_target'};
      const wp={x:from.x+dx/d*Math.min(d,0.9),y:from.y,
        z:from.z+dz/d*Math.min(d,0.9)};
      return {status:'route_found',waypoint:wp,path:[from,wp]};
    },
    movement:{capability(){return 'experimental';},
      snapshot(){return {active:false};},
      runVerifiedStep(world,target){count++;return {status:'accepted'};}},
    autonomy:{snapshot(){return {active:false};}},
    intelligence:brain,intelligenceTick(){},
    lifeSenses:{snapshot(){return life;}},
    layerThree:{
      snapshot(){return {inventoryKnown:true,nearbyItemNames:selected?[
        selected
      ]:['minecraft:apple'],observedDrops:1};},
      planCollect(item,n){selected=item;return {status:'accepted'};},
      preview(){
        return selected?collected?
          {status:'observed_inventory_increase',itemName:selected}:
          {status:'route_unverified',itemName:selected,reason:'needs_collision',
            nextPoint:{x:1.5,y:65.62,z:0.5}}:
          {status:'idle'};
      },
      cancel(){cancelled++;}
    },
    layerFour:{planFood(){foodPlans++;return {status:'accepted'};}},
    layerTwo:{snapshot(){return {homeKnown:false,preview:{goal:null}};}},
    gameplayWorld(){return {position:this.position,dimension:0,
      spawned:true,chunks:1,safetyHold:false};}
  };
  return {agent,world,brain,setLife(v){life={...life,...v};},
    setSelected(v){selected=v;},setCollected(v){collected=v;},
    advance(ms){now+=ms;world.lastServerPositionAt=now;},
    get sent(){return count;},get cancelled(){return cancelled;},
    get foodPlans(){return foodPlans;}};
}

test('survival mission seeks observed dropped food using only existing validated movement',()=>{
  const f=setup();
  const r=f.agent.start(f.world,{goal:'survive',confirmed:true});
  assert.equal(r.status,'accepted');
  assert.equal(f.brain.snapshot().goal,'survive');
  f.agent.pulse();
  assert.equal(f.sent,1);
  assert.equal(f.agent.snapshot().currentSubgoal.item,'minecraft:apple');
  assert.equal(f.agent.snapshot().serverVerifiedSteps,0);
  f.setCollected(true);
  f.agent.awaiting=null;
  f.advance(1000);
  f.agent.pulse();
  assert.equal(f.agent.snapshot().collectedDrops,1);
  assert.equal(f.cancelled,1);
  assert.equal(f.agent.snapshot().currentSubgoal,null);
  assert.equal(f.agent.snapshot().autonomousEating,false);
  f.agent.stop();
});
test('food emergency refuses unrelated drops and never emits use-item or guessed packets',()=>{
  const f=setup();
  f.setSelected('minecraft:stone');
  f.setLife({hunger:2});
  f.agent.start(f.world,{goal:'survive',confirmed:true});
  f.agent.pulse();
  assert.equal(f.sent,0);
  assert.equal(f.foodPlans,1);
  assert.equal(f.agent.snapshot().reason,'food_needed_no_verified_item_use');
});
test('manifest never labels unsupported food, attacks, recipes or building as executable',()=>{
  const f=setup();
  const catalog=gameplaySkillManifest(f.world);
  assert.equal(catalog.version,'minepilot.gameplay.skills.v1');
  assert.equal(catalog.rawPacketAccess,false);
  assert.equal(catalog.userConfirmationRequired,true);
  assert.ok(catalog.permittedGoalNames.includes('survive'));
  const skill=Object.fromEntries(catalog.skills.map(x=>[x.name,x]));
  assert.equal(skill.explore.state,'experimental');
  for(const name of ['eat_food','attack_hostile','craft'])
    assert.equal(skill[name].state,'unsupported');
  assert.equal(skill.build_shelter.state,'preview_only');
  assert.equal(skill.collect_observed_drops.state,'experimental');
  f.world.movement.capability=()=> 'unavailable';
  const blocked=Object.fromEntries(gameplaySkillManifest(f.world).skills.map(x=>[x.name,x]));
  assert.equal(blocked.explore.state,'blocked');
  assert.equal(blocked.collect_observed_drops.state,'blocked');
});
test('survival consent never enables itself, and the manifest uses current session only',()=>{
  const f=setup();
  assert.equal(f.agent.start(f.world,{goal:'survive'}).reason,'confirmation_required');
  f.world.spawned=false;
  assert.equal(gameplaySkillManifest(f.world).worldReady,false);
  assert.equal(gameplaySkillManifest(f.world).skills.find(x=>x.name==='observe_world').state,'blocked');
});
test('gameplay bridge exports bounded skill metadata and no new packet writers',()=>{
  const client=new EventEmitter();const sent=[];
  client.queue=(packet)=>sent.push(packet);
  const bridge=new BedrockGameplayBridge(client,{clock:()=>1000}).start();
  const result=bridge.snapshot();
  assert.equal(result.gameplaySkills.worldReady,false);
  assert.equal(result.gameplaySkills.userConfirmationRequired,true);
  assert.equal(result.gameplaySkills.rawPacketAccess,false);
  assert.ok(result.gameplaySkills.skills.length>=10);
  assert.deepEqual(sent,[]);
  bridge.stop();
});
