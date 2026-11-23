import assert from 'node:assert/strict';
import test from 'node:test';
import { LayerThreePlanner } from '../src/gameplay/layer-three.js';

const world = { position: { x: 0, y: 64, z: 0 },
  dimension: 0, chunks: 2, spawned: true, safetyHold: false };
const registry = { itemstates: [
  { runtime_id: 5, name: 'minecraft:oak_log', nbt: { unexpected: 'ignored' } },
  { runtime_id: 9, name: 'minecraft:stone' },
  { runtime_id: 12, name: 'minecraft:dirt' }
] };
const drop = (id: bigint, itemId: number, x = 8, count = 1) => ({
  runtime_entity_id: id, item: { network_id: itemId, count },
  position: { x, y: 64, z: 0 }
});
const command = (planner: LayerThreePlanner, item = 'minecraft:oak_log', count = 3) =>
  planner.planCollect(item, count, world);

test('resource registry and item drops produce a planning-only waypoint', () => {
  const p = new LayerThreePlanner(() => 1000);
  assert.equal(p.observeItemRegistry(registry), 3);
  assert.equal(p.observeDrop(drop(24n, 5), 0), true);
  assert.equal(command(p).reason, 'collect_plan_only');
  const view = p.snapshot(world);
  assert.deepEqual(view.nearbyItemNames, ['minecraft:oak_log']);
  assert.equal(view.route.status, 'route_unverified');
  assert.equal(view.route.nextPoint?.x, 1);
  assert.equal(view.route.heading, 270);
  assert.equal(view.route.executed, false);
  assert.equal(view.route.requested, 3);
  assert.equal(view.route.observed, 0);
});

test('unknown items and invalid counts are rejected, not guessed', () => {
  const p = new LayerThreePlanner(() => 1000);
  assert.equal(command(p).reason, 'item_not_in_registry');
  p.observeItemRegistry(registry);
  assert.equal(command(p, 'minecraft:diamonds').reason, 'item_not_in_registry');
  assert.equal(command(p, 'minecraft:oak_log', 1000).reason, 'invalid_count');
  assert.equal(command(p, 'minecraft:oak_log', 0).reason, 'invalid_count');
  assert.equal(p.planCollect('minecraft:oak_log', 1,
    { ...world, safetyHold: true }).reason, 'critical_health');
  assert.equal(p.planCollect('minecraft:oak_log', 1,
    { ...world, chunks: 0 }).reason, 'world_not_ready');
});

test('server-confirmed pickup and inventory gain are both required for observed progress', () => {
  const p = new LayerThreePlanner(() => 1000);
  p.observeItemRegistry(registry);
  assert.equal(p.observeInventory({ window_id: 'inventory',
    input: [{ network_id: 5, count: 2 }, { network_id: 9, count: 4 }] }), true);
  assert.equal(command(p, 'minecraft:oak_log', 3).status, 'accepted');
  p.observeDrop(drop(24n, 5, 2, 2), 0);
  p.observeDrop(drop(25n, 5, 3, 1), 0);
  assert.equal(p.observeTake({ runtime_entity_id: 24n, target: 999n }, 123n), false);
  assert.equal(p.observeInventory({ window_id: 'inventory',
    input: [{ network_id: 5, count: 4 }, { network_id: 9, count: 4 }] }), true);
  assert.equal(p.snapshot(world).route.observed, 0, 'inventory gain alone is insufficient');
  assert.equal(p.observeTake({ runtime_entity_id: 24n, target: 123n }, 123n), true);
  p.observeInventory({ window_id: 'inventory', input: [
    { network_id: 5, count: 6 }, { network_id: 9, count: 4 }
  ] });
  assert.equal(p.snapshot(world).route.observed, 2);
  assert.equal(p.snapshot(world).route.status, 'waiting_for_item');
  assert.equal(p.observeTake({ runtime_entity_id: 25n, target: 123n }, 123n), true);
  p.observeInventory({ window_id: 'inventory', input: [
    { network_id: 5, count: 7 }, { network_id: 9, count: 4 }
  ] });
  assert.equal(p.snapshot(world).route.observed, 3);
  assert.equal(p.snapshot(world).route.status, 'observed_inventory_increase');
  assert.equal(p.snapshot(world).route.executed, false,
    'passive item gain is not an autonomous bot interaction');
});

test('an updated block is an observation, never proof that the bot mined it', () => {
  const p = new LayerThreePlanner(() => 1000);
  assert.equal(p.planInspectBlock(world).reason, 'block_observation_only');
  assert.equal(p.preview(world).status, 'waiting_for_block_update');
  assert.equal(p.observeBlock({ position: { x: 9, y: 64, z: 0 },
    block_runtime_id: 475, layer: 0 }, 0), true);
  assert.equal(p.preview(world).status, 'route_unverified');
  assert.equal(p.preview(world).target?.x, 9);
  assert.equal(p.preview(world).executed, false);
  assert.equal(p.observeBlock({ position: { x: 9, y: 64, z: 0 },
    block_runtime_id: 0, layer: 1 }, 0), false);
  assert.equal(p.snapshot(world).observedBlockUpdates, 1);
});

test('stale drops, dimension changes and cancellation fail closed', () => {
  let now = 1000;
  const p = new LayerThreePlanner(() => now);
  p.observeItemRegistry(registry);
  p.observeDrop(drop(24n, 5), 0);
  command(p);
  assert.equal(p.preview(world).status, 'route_unverified');
  now += 15001;
  assert.equal(p.preview(world).status, 'waiting_for_item');
  p.observeDrop(drop(25n, 5), 0);
  assert.equal(p.snapshot({ ...world, dimension: 1 }).observedDrops, 0);
  p.dimensionChanged();
  assert.equal(p.preview(world).status, 'idle');
  assert.equal(p.snapshot(world).registeredItems, 3);
  p.planCollect('minecraft:oak_log', 2, world);
  p.cancel();
  assert.equal(p.preview(world).status, 'idle');
  p.reset();
  assert.equal(p.snapshot(world).registeredItems, 0);
});

test('bounded block, item, registry, inventory and actor data reject malformed inputs', () => {
  const p = new LayerThreePlanner(() => 1000);
  assert.equal(p.observeItemRegistry({ itemstates: [{ runtime_id: 7,
    name: '<malicious>' }] }), 0);
  assert.equal(p.observeItemRegistry({ itemstates: Array.from({ length: 9000 },
    (_, i) => ({ runtime_id: i + 1, name: 'minecraft:stone' })) }), 0);
  p.observeItemRegistry(registry);
  assert.equal(p.observeDrop(drop(24n, 0), 0), false);
  assert.equal(p.observeDrop(drop(24n, 5), 9), false);
  assert.equal(p.observeDrop(drop(24n, 5), 0), true);
  assert.equal(p.observeInventory({ window_id: 3, input: [] }), false);
  assert.equal(p.observeInventory({ window_id: 'inventory', input: [] }), true);
  p.observeDrop(drop(25n, 9), 0);
  p.removeEntity(24n);
  assert.deepEqual(p.snapshot(world).nearbyItemNames, ['minecraft:stone']);
  assert.equal(p.observeBlock({ position: { x: 1.1, y: 64, z: 2 },
    layer: 0, block_runtime_id: 123 }, 0), false);
});

test('within range of dropped resources does not imply pickup is executed', () => {
  const p = new LayerThreePlanner(() => 1000);
  p.observeItemRegistry(registry);
  p.observeDrop(drop(24n, 5, 1), 0);
  command(p);
  assert.equal(p.preview(world).status, 'within_range');
  assert.equal(p.preview(world).reason, 'in_range_no_interaction_emitted');
  assert.equal(p.snapshot(world).pickupCorrelations, false);
});
