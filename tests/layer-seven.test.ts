import assert from 'node:assert/strict';
import test from 'node:test';
import { LayerSevenAdvisor, type AdvisorWorld } from '../src/gameplay/layer-seven.js';
const world: AdvisorWorld = {
  spawned: true, positionKnown: true, chunks: 3, safetyHold: false,
  survivalLevel: 'stable', survivalReason: 'observed_vitals_stable',
  foodOptions: 0, taskStatus: 'none', followStatus: 'idle',
  resourceStatus: 'idle', buildStatus: 'idle', workflowStatus: 'idle'
};
test('adviser defaults off and never executes a gameplay action', () => {
  const bot = new LayerSevenAdvisor(()=>1000);
  assert.equal(bot.snapshot(world).mode,'off');
  assert.equal(bot.snapshot(world).recommendation.status,'disabled');
  assert.equal(bot.review(world).status,'rejected');
  assert.equal(bot.setMode('autonomous').status,'rejected');
  assert.equal(bot.setMode('suggestions').status,'accepted');
  assert.equal(bot.snapshot(world).recommendation.action,'inspect');
  assert.equal(bot.snapshot(world).recommendation.executed,false);
});
test('critical health or drowning interrupts even without world position', () => {
  const bot = new LayerSevenAdvisor(()=>1000);
  bot.setMode('suggestions');
  const advice = bot.snapshot({...world,positionKnown:false,safetyHold:true}).recommendation;
  assert.equal(advice.action,'stop');
  assert.equal(advice.status,'hold');
  assert.equal(advice.approvalRequired,true);
  assert.equal(advice.executed,false);
});
test('recommendations follow safe priorities without claiming abilities', () => {
  const bot = new LayerSevenAdvisor(()=>1000);
  bot.setMode('suggestions');
  assert.equal(bot.snapshot({...world,spawned:false}).recommendation.action,'wait');
  assert.equal(bot.snapshot({...world,survivalLevel:'caution',survivalReason:'low_hunger',foodOptions:2})
    .recommendation.action,'plan_food');
  assert.equal(bot.snapshot({...world,taskStatus:'ready_to_replan'}).recommendation.action,'review_task');
  assert.equal(bot.snapshot({...world,followStatus:'route_unverified'}).recommendation.action,'review_terrain');
  assert.equal(bot.snapshot({...world,resourceStatus:'within_range'}).recommendation.action,'review_terrain');
  assert.equal(bot.snapshot({...world,buildStatus:'materials_missing'}).recommendation.action,'review_materials');
  assert.equal(bot.snapshot({...world,workflowStatus:'waiting_for_verification'}).recommendation.action,'review_task');
});
test('journal is in-memory, bounded, deduplicated and cleared when user disables', () => {
  let now=1000;
  const bot = new LayerSevenAdvisor(()=>now);
  bot.setMode('suggestions');
  for(let i=0;i<100;i++) {
    now++;
    bot.review({...world,followStatus:i%2===0?'route_unverified':'idle'});
  }
  assert.equal(bot.snapshot(world).journalSize,32);
  assert.equal(bot.snapshot(world).journal.length,32);
  const last=bot.snapshot(world).journal.at(-1);
  assert.equal(typeof last?.at,'number');
  assert.equal(last?.reason,'ready_for_inspection');
  const before=bot.snapshot(world).journalSize;
  bot.review({...world,followStatus:'idle'});
  assert.equal(bot.snapshot(world).journalSize,before);
  bot.setMode('off');
  assert.equal(bot.snapshot(world).journalSize,0);
  bot.reset();
  assert.equal(bot.snapshot(world).mode,'off');
});
