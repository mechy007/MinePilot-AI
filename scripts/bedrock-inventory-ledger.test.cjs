'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { BedrockInventoryLedger, normalizeContainer, normalizeItem, planPlayerInventorySwap, planPlayerInventoryMove } = require('./bedrock-inventory-ledger.cjs');
const { normalizeAction } = require('./bedrock-stack-request-manager.cjs');

const container = { container_id: 'hotbar_and_inventory' };
const item = (network_id, count = 1, stack_id = 7) => ({
  network_id, count, metadata: 0, has_stack_id: network_id !== 0,
  ...(network_id === 0 ? {} : { stack_id }), block_runtime_id: 0
});
const full = (input, window_id = 0, containerValue = container) => ({
  window_id, input, container: containerValue, storage_item: item(0, 0)
});

test('decodes Bedrock 1.26.60 ItemV4 stack IDs and full container identity', () => {
  assert.deepEqual(normalizeContainer({ container_id: 'container', dynamic_container_id: 3 }),
    { container_id: 'container', dynamic_container_id: 3 });
  assert.equal(normalizeContainer({ container_id: 'not_a_protocol_container' }), null);
  assert.deepEqual(normalizeItem(item(5, 12, 41)), {
    empty: false, networkId: 5, count: 12, metadata: 0,
    hasStackId: true, stackId: 41, blockRuntimeId: 0
  });
  assert.equal(normalizeItem(item(0, 0)).empty, true);
  const emptyWithStackId = normalizeItem({ network_id: 0, count: 0, metadata: 0,
    has_stack_id: true, stack_id: 0, block_runtime_id: 0 });
  assert.equal(emptyWithStackId.empty, true);
  assert.equal(emptyWithStackId.hasStackId, true);
  assert.equal(emptyWithStackId.stackId, 0);
  assert.equal(normalizeItem({ network_id: 0, count: 1, metadata: 0,
    has_stack_id: false, block_runtime_id: 0 }), null);
  assert.equal(normalizeItem({ network_id: 5, count: 1, metadata: 0, has_stack_id: true }), null);
  assert.equal(normalizeItem({ network_id: 5, count: 1, metadata: 0,
    has_stack_id: false, stack_id: 99 }), null);
});

test('full inventory snapshot distinguishes known empty slots from unknown inventory', () => {
  let now = 1000;
  const ledger = new BedrockInventoryLedger({ clock: () => now });
  assert.equal(ledger.playerInventory().known, false);
  const slots = Array.from({ length: 36 }, () => item(0, 0));
  slots[0] = item(5, 12, 41);
  slots[9] = item(8, 4, 44);
  assert.equal(ledger.observeItemRegistry({ itemstates: [
    { runtime_id: 5, name: 'minecraft:oak_log' },
    { runtime_id: 8, name: 'minecraft:stick' }
  ] }), true);
  assert.equal(ledger.observeContent(full(slots)), true);
  const inventory = ledger.playerInventory();
  assert.equal(inventory.known, true);
  assert.equal(inventory.fresh, true);
  assert.equal(inventory.slotCount, 36);
  assert.equal(inventory.occupied, 2);
  assert.equal(inventory.items[0].itemName, 'minecraft:oak_log');
  assert.equal(inventory.items[9].stackId, 44);
  assert.equal(inventory.items[1].empty, true);
  ledger.reset();
  assert.equal(ledger.playerInventory().known, false);
});

test('incremental slot updates preserve full-snapshot freshness and stack identity', () => {
  let now = 1000;
  const ledger = new BedrockInventoryLedger({ clock: () => now, maxAgeMs: 5000 });
  const slots = Array.from({ length: 36 }, () => item(0, 0));
  slots[2] = item(5, 3, 31);
  ledger.observeContent(full(slots));
  now = 4000;
  assert.equal(ledger.observeSlot({ window_id: 0, slot: 2, item: item(5, 2, 32) }), true);
  const updated = ledger.getSlot({ window_id: 0, container, slot: 2 });
  assert.equal(updated.item.stackId, 32);
  assert.equal(updated.source, 'incremental');
  assert.ok(updated.slotRevision > 1);
  assert.equal(updated.fresh, true);
  assert.equal(updated.fullSnapshotFresh, true);
  now = 7000;
  const stale = ledger.playerInventory();
  assert.equal(stale.known, true);
  assert.equal(stale.fresh, false, 'slot delta must not renew the full inventory snapshot');
  assert.equal(ledger.getSlot({ window_id: 0, container, slot: 2 }).fresh, true,
    'the changed slot has its own freshness timestamp');
});

test('container snapshots are isolated by window and dynamic container ID', () => {
  const ledger = new BedrockInventoryLedger();
  const chest = { container_id: 'container', dynamic_container_id: 5 };
  const otherChest = { container_id: 'container', dynamic_container_id: 6 };
  assert.equal(ledger.observeContent(full([item(5, 2, 10)], 1, chest)), true);
  assert.equal(ledger.observeContent(full([item(8, 4, 11)], 1, otherChest)), true);
  assert.equal(ledger.getSlot({ window_id: 1, container: chest, slot: 0 }).item.networkId, 5);
  assert.equal(ledger.getSlot({ window_id: 1, container: otherChest, slot: 0 }).item.networkId, 8);
  assert.equal(ledger.observeSlot({ window_id: 1, slot: 0, item: item(9, 1, 12) }), false,
    'container-less slot delta is rejected when its window is ambiguous');
  assert.equal(ledger.observeSlot({ window_id: 1, container: chest, slot: 0, item: item(9, 1, 12) }), true);
  assert.equal(ledger.getSlot({ window_id: 1, container: chest, slot: 0 }).item.networkId, 9);
  assert.equal(ledger.getSlot({ window_id: 1, container: otherChest, slot: 0 }).item.networkId, 8);
});

test('malformed and out-of-range packets are rejected atomically', () => {
  const ledger = new BedrockInventoryLedger();
  assert.equal(ledger.observeContent(full([item(5, 1, 7), { network_id: 5, count: 0 }])), false);
  assert.equal(ledger.playerInventory().known, false);
  assert.equal(ledger.observeContent({ window_id: 0, input: [item(5)], container: { container_id: 'unknown' } }), false);
  assert.equal(ledger.observeContent(full([item(5)])), true);
  assert.equal(ledger.observeSlot({ window_id: 0, slot: 9, item: item(5) }), false);
  assert.equal(ledger.observeSlot({ window_id: 0, slot: 0, item: { network_id: 5, count: 1,
    metadata: 0, has_stack_id: true } }), false);
  assert.equal(ledger.snapshot().lastError, 'invalid_inventory_item');
});

test('inventory windows remain bounded and session reset invalidates all old slot identities', () => {
  const ledger = new BedrockInventoryLedger();
  for (let id = 1; id <= 20; id++) {
    assert.equal(ledger.observeContent(full([item(id, 1, id)], id, { container_id: 'container',
      dynamic_container_id: id })), true);
  }
  assert.ok(ledger.snapshot().windows.length <= 16);
  const generation = ledger.snapshot().generation;
  ledger.reset();
  assert.equal(ledger.snapshot().windows.length, 0);
  assert.equal(ledger.snapshot().generation, generation + 1);
  assert.equal(ledger.getSlot({ window_id: 1,
    container: { container_id: 'container', dynamic_container_id: 20 }, slot: 0 }).known, false);
});


test('player inventory swap planning requires fresh resolved server stacks and preserves exact stack IDs', () => {
  const ledger = new BedrockInventoryLedger({ clock: () => 1000 });
  ledger.observeItemRegistry({ itemstates: [
    { runtime_id: 5, name: 'minecraft:oak_log' },
    { runtime_id: 8, name: 'minecraft:iron_pickaxe' }
  ] });
  const slots = Array.from({ length: 36 }, () => item(0, 0));
  slots[0] = item(5, 12, 41);
  slots[9] = item(8, 1, 77);
  ledger.observeContent(full(slots));
  const plan = planPlayerInventorySwap(ledger, 0, 9);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.executable, false,
    'a plan is not permission to dispatch before the transaction executor exists');
  assert.equal(plan.action.type_id, 'swap');
  assert.equal(plan.sourceSlotRevision, 1);
  assert.equal(plan.destinationSlotRevision, 1);
  assert.deepEqual(plan.action.source, {
    slot_type: { container_id: 'hotbar_and_inventory' }, slot: 0, stack_id: 41
  });
  assert.deepEqual(plan.action.destination, {
    slot_type: { container_id: 'hotbar_and_inventory' }, slot: 9, stack_id: 77
  });
  assert.equal(normalizeAction(plan.action).type_id, 'swap',
    'the preflight plan must serialize through the same allowlisted request validator');
  assert.deepEqual(plan.expected.source, {
    networkId: 8, count: 1, metadata: 0, blockRuntimeId: 0
  });
  assert.deepEqual(plan.expected.destination, {
    networkId: 5, count: 12, metadata: 0, blockRuntimeId: 0
  });
});

test('player inventory swap planning blocks stale, empty, unresolved and no-op slots', () => {
  let now = 1000;
  const ledger = new BedrockInventoryLedger({ clock: () => now });
  ledger.observeItemRegistry({ itemstates: [
    { runtime_id: 5, name: 'minecraft:oak_log' },
    { runtime_id: 8, name: 'minecraft:iron_pickaxe' }
  ] });
  const slots = Array.from({ length: 36 }, () => item(0, 0));
  slots[0] = item(5, 12, 41);
  slots[9] = item(8, 1, 77);
  ledger.observeContent(full(slots));
  assert.equal(planPlayerInventorySwap(ledger, 0, 0).reason,
    'source_and_destination_are_same_slot');
  assert.equal(planPlayerInventorySwap(ledger, 0, 1).reason,
    'swap_requires_two_occupied_slots');
  now = 20000;
  assert.equal(planPlayerInventorySwap(ledger, 0, 9).reason,
    'player_inventory_snapshot_stale');

  const unresolved = new BedrockInventoryLedger({ clock: () => 1000 });
  const unresolvedSlots = Array.from({ length: 36 }, () => item(0, 0));
  unresolvedSlots[0] = item(5, 1, 10);
  unresolvedSlots[1] = item(8, 1, 11);
  unresolved.observeContent(full(unresolvedSlots));
  assert.equal(planPlayerInventorySwap(unresolved, 0, 1).reason,
    'resolved_item_registry_required');

  const same = new BedrockInventoryLedger({ clock: () => 1000 });
  same.observeItemRegistry({ itemstates: [{ runtime_id: 5, name: 'minecraft:oak_log' }] });
  const sameSlots = Array.from({ length: 36 }, () => item(0, 0));
  sameSlots[0] = item(5, 2, 10);
  sameSlots[1] = item(5, 2, 11);
  same.observeContent(full(sameSlots));
  assert.equal(planPlayerInventorySwap(same, 0, 1).reason,
    'swap_has_no_observable_inventory_change');
});


test('player inventory move planning requires a server-identified empty destination and emits a take plan', () => {
  const ledger = new BedrockInventoryLedger({ clock: () => 1000 });
  ledger.observeItemRegistry({ itemstates: [
    { runtime_id: 5, name: 'minecraft:oak_log' }
  ] });
  const emptyWithNetIdZero = () => ({ network_id: 0, count: 0, metadata: 0,
    has_stack_id: true, stack_id: 0, block_runtime_id: 0 });
  const slots = Array.from({ length: 36 }, emptyWithNetIdZero);
  slots[9] = item(5, 12, 41);
  ledger.observeContent(full(slots));
  const plan = planPlayerInventoryMove(ledger, 9, 0, 4);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.executable, false);
  assert.equal(plan.action.type_id, 'take');
  assert.equal(plan.action.count, 4);
  assert.equal(normalizeAction(plan.action).type_id, 'take');
  assert.deepEqual(plan.action.source, {
    slot_type: { container_id: 'hotbar_and_inventory' }, slot: 9, stack_id: 41
  });
  assert.deepEqual(plan.action.destination, {
    slot_type: { container_id: 'hotbar_and_inventory' }, slot: 0, stack_id: 0
  });
  assert.deepEqual(plan.expected.source, {
    empty: false, networkId: 5, count: 8, metadata: 0, blockRuntimeId: 0
  });
  assert.deepEqual(plan.expected.destination, {
    empty: false, networkId: 5, count: 4, metadata: 0, blockRuntimeId: 0
  });
  assert.equal(planPlayerInventoryMove(ledger, 9, 0, 13).reason,
    'transfer_count_exceeds_source_stack');
  assert.equal(planPlayerInventoryMove(ledger, 9, 36, 1).reason,
    'invalid_player_inventory_slot');
  const slotsWithoutDestinationId = [...slots];
  slotsWithoutDestinationId[1] = item(0, 0);
  const noEmptyNetId = new BedrockInventoryLedger({ clock: () => 1000 });
  noEmptyNetId.observeItemRegistry({ itemstates: [{ runtime_id: 5, name: 'minecraft:oak_log' }] });
  noEmptyNetId.observeContent(full(slotsWithoutDestinationId));
  assert.equal(planPlayerInventoryMove(noEmptyNetId, 9, 1, 1).reason,
    'server_empty_destination_stack_id_zero_required');
});
