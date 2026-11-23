import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCompanionCues, CompanionIntentLease } from '../src/gameplay/companion-skill-policy.js';
import { LayerSevenAdvisor } from '../src/gameplay/layer-seven.js';

const base = {
  spawned: true, positionKnown: true, chunkHeaders: 3,
  playerGameMode: 'survival', loadingPacketsSent: 2, loadingErrors: 0,
  movementAuthority: 1, safetyHold: false, survivalReason: 'observed_vitals_stable',
  taskStatus: 'none', foodOptions: 0, buildStatus: 'idle', workflowStatus: 'idle',
  isNight: false
};
test('original companion priorities distinguish ghost spawn, game mode, authority and water/food',()=>{
  const world=base;
  assert.equal(evaluateCompanionCues({...world, spawned:false}).action,'review_spawn');
  assert.equal(evaluateCompanionCues({...world, loadingPacketsSent:0}).reason,'loading_handshake_not_complete');
  assert.equal(evaluateCompanionCues({...world, playerGameMode:'spectator'}).action,'review_game_mode');
  assert.equal(evaluateCompanionCues({...world, movementAuthority:null}).action,'review_movement');
  assert.equal(evaluateCompanionCues({...world, survivalReason:'air_supply_decreasing'}).action,'review_water_escape');
  assert.equal(evaluateCompanionCues({...world, survivalReason:'low_hunger',foodOptions:2}).action,'plan_food');
  assert.equal(evaluateCompanionCues({...world, isNight:true}).action,'review_shelter');
  assert.equal(evaluateCompanionCues({...world, safetyHold:true, isNight:true,
    playerGameMode:'creative'}).action,'stop');
});
test('every cue remains suggestion-only and never asserts verified block/world actions',()=>{
  for(const world of [
    base,{...base,isNight:true},{...base,loadingErrors:1},
    {...base,movementAuthority:null},{...base,survivalReason:'air_supply_decreasing'}
  ]) {
    const suggestion=evaluateCompanionCues(world);
    assert.equal(suggestion.executed,false);
    assert.equal(suggestion.requiresUserApproval,true);
    assert.ok(['block','caution','informational'].includes(suggestion.urgency));
  }
});
test('bounded lease ensures emergency priority and expiry without executing gameplay',()=>{
  let now=1000;
  const lease=new CompanionIntentLease(()=>now);
  assert.equal(lease.acquire('follow',20,1000).accepted,true);
  assert.equal(lease.acquire('farm',20,1000).reason,'owned_by_higher_priority_task');
  assert.equal(lease.acquire('emergency',100,1000).accepted,true);
  assert.equal(lease.snapshot().owner,'emergency');
  assert.equal(lease.snapshot().executed,false);
  assert.equal(lease.release('follow'),false);
  now=2001;
  assert.equal(lease.snapshot().owner,null);
  assert.equal(lease.acquire('follow',10,5001).reason,'invalid_lease_request');
  assert.equal(lease.acquire('farm',20,500).accepted,true);
  lease.stop();
  assert.equal(lease.snapshot().owner,null);
  lease.reset();
});
test('existing advisor integrates addon-inspired cues while disabled by default',()=>{
  const bot=new LayerSevenAdvisor(()=>1000);
  const world={
    spawned:true,positionKnown:true,chunks:3,safetyHold:false,
    survivalLevel:'stable' as const,survivalReason:'observed_vitals_stable',
    foodOptions:0,taskStatus:'none',followStatus:'idle',resourceStatus:'idle',
    buildStatus:'idle',workflowStatus:'idle',playerGameMode:'creative',
    loadingPacketsSent:2,movementAuthority:1,isNight:false
  };
  assert.equal(bot.snapshot(world).recommendation.status,'disabled');
  bot.setMode('suggestions');
  assert.equal(bot.snapshot(world).recommendation.action,'review_game_mode');
  assert.equal(bot.review(world).status,'ok');
  assert.equal(bot.snapshot(world).journalSize,1);
  assert.equal(bot.snapshot({...world,playerGameMode:'survival',isNight:true})
    .recommendation.action,'review_shelter');
  assert.equal(bot.snapshot({...world,playerGameMode:'survival',
    survivalReason:'air_supply_decreasing',isNight:true}).recommendation.action,'review_water_escape');
  assert.equal(bot.snapshot(world).recommendation.executed,false);
});
