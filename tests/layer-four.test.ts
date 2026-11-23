import assert from 'node:assert/strict';
import test from 'node:test';
import { LayerFourSupervisor } from '../src/gameplay/layer-four.js';
import { LayerThreePlanner } from '../src/gameplay/layer-three.js';

test('critical health pauses an existing goal, recovery preserves the plan only', () => {
  const supervisor = new LayerFourSupervisor(() => 2000);
  supervisor.setTask('collect');
  assert.equal(supervisor.observeVitals({ health: 20, maxHealth: 20, hunger: 18 }).becameCritical, false);
  assert.equal(supervisor.snapshot().level, 'stable');
  assert.equal(supervisor.observeVitals({ health: 4 }).becameCritical, true);
  assert.equal(supervisor.critical, true);
  assert.equal(supervisor.snapshot().taskStatus, 'paused');
  assert.equal(supervisor.snapshot().pausedGoal, 'collect');
  assert.equal(supervisor.observeVitals({ health: 19 }).recovered, true);
  assert.equal(supervisor.snapshot().taskStatus, 'ready_to_replan');
  assert.equal(supervisor.snapshot().executed, false);
  supervisor.cancel();
  assert.equal(supervisor.snapshot().taskStatus, 'none');
});

test('low air stops the task even when health is full; unknown vitals never imply safety', () => {
  const supervisor = new LayerFourSupervisor(() => 3000);
  assert.equal(supervisor.snapshot().level, 'unknown');
  supervisor.setTask('follow');
  assert.equal(supervisor.observeVitals({ air: 2, health: 20 }).becameCritical, true);
  assert.equal(supervisor.snapshot().reason, 'low_air_supply');
  assert.equal(supervisor.snapshot().taskStatus, 'paused');
  supervisor.observeVitals({ air: 20 });
  assert.equal(supervisor.snapshot().taskStatus, 'ready_to_replan');
  assert.equal(supervisor.snapshot().executed, false);
  supervisor.observeVitals({ air: Number.NaN, health: -3 });
  assert.equal(supervisor.snapshot().level, 'stable');
});

test('nighttime is only an advisory: no fabricated danger or shelter action', () => {
  const supervisor = new LayerFourSupervisor(() => 1000);
  assert.equal(supervisor.observeTime(-1), false);
  assert.equal(supervisor.observeTime(24000), true);
  assert.equal(supervisor.snapshot().isNight, false);
  assert.equal(supervisor.observeTime(14000), true);
  assert.equal(supervisor.snapshot().reason, 'night_advisory_only');
  assert.equal(supervisor.critical, false);
  assert.equal(supervisor.snapshot().executed, false);
});

test('food suggestions use only server inventory plus validated registry, never item use', () => {
  const resource = new LayerThreePlanner(() => 1000);
  const supervisor = new LayerFourSupervisor(() => 1000);
  resource.observeItemRegistry({ itemstates: [
    { name: 'minecraft:bread', runtime_id: 10 },
    { name: 'minecraft:apple', runtime_id: 11 },
    { name: 'minecraft:stone', runtime_id: 12 }
  ] });
  supervisor.observeVitals({ hunger: 4 });
  assert.equal(supervisor.planFood().reason, 'inventory_not_observed');
  resource.observeInventory({ window_id: 'inventory', input: [
    { count: 2, network_id: 10 }, { count: 3, network_id: 11 },
    { count: 64, network_id: 12 }, { count: 0, network_id: 10 }
  ] });
  supervisor.observeInventory(resource.inventoryItems());
  assert.deepEqual(supervisor.snapshot().foodOptions, [
    { item: 'minecraft:apple', count: 3 }, { item: 'minecraft:bread', count: 2 }
  ]);
  assert.equal(supervisor.planFood().status, 'accepted');
  assert.equal(supervisor.snapshot().foodPlan?.item, 'minecraft:apple');
  assert.equal(supervisor.snapshot().foodPlan?.status, 'planned_not_executed');
  assert.equal(supervisor.snapshot().executed, false);
});

test('food planning fails closed for full hunger, unavailable registry or missing food', () => {
  const supervisor = new LayerFourSupervisor(() => 1000);
  supervisor.observeInventory({ known: true, observedAt: 1000, counts: {
    'minecraft:stone': 64, '<malicious>': 500, 'minecraft:bread': -4
  } });
  supervisor.observeVitals({ hunger: 20 });
  assert.equal(supervisor.planFood().reason, 'not_hungry');
  supervisor.observeVitals({ hunger: 5 });
  assert.equal(supervisor.planFood().reason, 'no_verified_food_in_inventory');
  supervisor.observeInventory({ known: false, observedAt: null, counts: {} });
  assert.equal(supervisor.planFood().reason, 'inventory_not_observed');
  supervisor.reset();
  assert.equal(supervisor.snapshot().observedAt, null);
  assert.equal(supervisor.snapshot().foodOptions.length, 0);
});

test('dimension changes wipe food and interrupted task state, never resumes blindly', () => {
  const supervisor = new LayerFourSupervisor(() => 1000);
  supervisor.setTask('return');
  supervisor.observeVitals({ health: 2 });
  supervisor.observeInventory({ known: true, observedAt: 1000, counts: {
    'minecraft:apple': 2
  } });
  supervisor.dimensionChanged();
  assert.equal(supervisor.snapshot().level, 'unknown');
  assert.equal(supervisor.snapshot().taskStatus, 'none');
  assert.equal(supervisor.snapshot().foodOptions.length, 0);
});
