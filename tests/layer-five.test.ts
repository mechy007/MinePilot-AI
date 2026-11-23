import assert from 'node:assert/strict';
import test from 'node:test';
import { LayerFivePlanner, simpleShelter } from '../src/gameplay/layer-five.js';
import { LayerThreePlanner } from '../src/gameplay/layer-three.js';
const w = { position: { x: 8.5, y: 64, z: 10.5 }, dimension: 0,
  spawned: true, chunks: 3, safetyHold: false };

test('3x3 shelter blueprint has 23 distinct steps and a two-high doorway', () => {
  const steps = simpleShelter(w.position, 'minecraft:oak_planks');
  assert.equal(steps.length, 23);
  const keys = steps.map(s => s.x + ':' + s.y + ':' + s.z);
  assert.equal(new Set(keys).size, 23);
  assert.equal(keys.includes('8:64:11'), false);
  assert.equal(keys.includes('8:65:11'), false);
  assert.equal(keys.includes('8:66:11'), true);
  assert.equal(steps.every(s => s.block === 'minecraft:oak_planks'), true);
  assert.throws(() => simpleShelter(w.position, 'minecraft:lava'));
});

test('shelter shows materials and terrain gates; planning never places a block', () => {
  const p = new LayerFivePlanner(() => 1000);
  assert.equal(p.planShelter('minecraft:oak_planks', w).reason, 'shelter_blueprint_only');
  let snap = p.snapshot(w);
  assert.equal(snap.kind, 'shelter');
  assert.equal(snap.state, 'requires_inventory');
  assert.equal(snap.required, 23);
  assert.equal(snap.executed, false);
  p.observeInventory({ known: true, observedAt: 1000, counts: { 'minecraft:oak_planks': 30 } });
  snap = p.snapshot(w);
  assert.equal(snap.state, 'waiting_for_terrain_verification');
  assert.equal(snap.onHand, 30);
  assert.equal(snap.missing, 0);
  assert.equal(snap.blockCount, 23);
  assert.equal(snap.executed, false);
});

test('inventory shortage gives a bounded recipe advisory, not claimed crafting', () => {
  const p = new LayerFivePlanner(() => 1000);
  p.planShelter('minecraft:oak_planks', w);
  p.observeInventory({ known: true, observedAt: 1000, counts: {
    'minecraft:oak_planks': 3, 'minecraft:oak_log': 6
  } });
  const state = p.snapshot(w);
  assert.equal(state.state, 'materials_missing');
  assert.equal(state.missing, 20);
  assert.equal(state.suggestedLogs, 5);
  assert.equal(state.logsOnHand, 6);
  assert.equal(state.executed, false);
  assert.equal(p.planCraftPlanks('minecraft:oak_planks', 24, w).status, 'accepted');
  assert.equal(p.snapshot(w).state, 'materials_missing');
  assert.equal(p.snapshot(w).required, 24);
  assert.equal(p.snapshot(w).missing, 21);
  p.cancel();
  assert.equal(p.snapshot(w).state, 'idle');
});

test('bamboo material uses two planks per block, not four', () => {
  const p = new LayerFivePlanner(() => 1000);
  p.planCraftPlanks('minecraft:bamboo_planks', 10, w);
  p.observeInventory({ known: true, observedAt: 1000, counts: {
    'minecraft:bamboo_planks': 2, 'minecraft:bamboo_block': 4
  } });
  assert.equal(p.snapshot(w).suggestedLogs, 4);
});

test('server block updates near plan are recorded but not counted as bot placement', () => {
  const p = new LayerFivePlanner(() => 1000);
  p.planShelter('minecraft:oak_planks', w);
  assert.equal(p.observeBlockUpdate({ position: { x: 8, y: 64, z: 9 }, layer: 0 }, 0), true);
  assert.equal(p.observeBlockUpdate({ position: { x: 8, y: 64, z: 9 }, layer: 0 }, 0), true);
  assert.equal(p.observeBlockUpdate({ position: { x: 8, y: 64, z: 9 }, layer: 0 }, 1), false);
  assert.equal(p.observeBlockUpdate({ position: { x: 8, y: 64, z: 11 }, layer: 0 }, 0), false);
  assert.equal(p.snapshot(w).observedNearbyBlockUpdates, 1);
  assert.equal(p.snapshot(w).executed, false);
});

test('invalid world, unsupported materials and safety hold reject creating plans', () => {
  const p = new LayerFivePlanner(() => 1000);
  assert.equal(p.planShelter('minecraft:lava', w).reason, 'unsupported_material');
  assert.equal(p.planShelter('minecraft:oak_planks', { ...w, chunks: 0 }).reason, 'world_not_ready');
  assert.equal(p.planShelter('minecraft:oak_planks', { ...w, safetyHold: true }).reason, 'survival_hold');
  assert.equal(p.planCraftPlanks('minecraft:oak_planks', 0, w).reason, 'invalid_count');
  assert.equal(p.planCraftPlanks('minecraft:oak_planks', 257, w).reason, 'invalid_count');
  assert.equal(p.planCraftPlanks('minecraft:oak_planks', 4, { ...w, safetyHold: true }).reason, 'survival_hold');
});

test('layer 5 receives sanitized server-backed inventory data from layer 3', () => {
  const resource = new LayerThreePlanner(() => 1000);
  resource.observeItemRegistry({ itemstates: [
    { runtime_id: 11, name: 'minecraft:oak_planks' },
    { runtime_id: 12, name: 'minecraft:oak_log' },
    { runtime_id: 13, name: 'minecraft:stone' }
  ] });
  resource.observeInventory({ window_id: 'inventory', input: [
    { network_id: 11, count: 20 }, { network_id: 12, count: 2 },
    { network_id: 13, count: 64 }
  ] });
  const p = new LayerFivePlanner(() => 1000);
  p.observeInventory(resource.inventoryItems());
  p.planShelter('minecraft:oak_planks', w);
  assert.equal(p.snapshot(w).missing, 3);
  assert.equal(p.snapshot(w).suggestedLogs, 1);
  assert.equal(p.snapshot(w).executed, false);
});

test('dimension changes and cancel clear plans and material knowledge', () => {
  const p = new LayerFivePlanner(() => 1000);
  p.planShelter('minecraft:oak_planks', w);
  p.observeInventory({ known: true, observedAt: 1000, counts: { 'minecraft:oak_planks': 32 } });
  p.dimensionChanged();
  assert.equal(p.snapshot(w).kind, 'none');
  p.planShelter('minecraft:oak_planks', w);
  assert.equal(p.snapshot(w).state, 'requires_inventory');
  p.reset();
  assert.equal(p.snapshot(w).state, 'idle');
});
