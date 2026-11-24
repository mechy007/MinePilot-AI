'use strict';

// Server-authoritative Bedrock 1.26.60 inventory mirror.
// Keeps full-container snapshots distinct from incremental slot updates.
// NBT/user data is deliberately not retained.

const MAX_WINDOWS = 16;
const MAX_SLOTS = 256;
const MAX_ITEM_ID = 32767;
const MAX_COUNT = 65535;
const MAX_AGE_MS = 15000;
const CONTAINER_IDS = new Set([
  'anvil_input','anvil_material','anvil_result','smithing_table_input',
  'smithing_table_material','smithing_table_result','armor','container',
  'beacon_payment','brewing_input','brewing_result','brewing_fuel',
  'hotbar_and_inventory','crafting_input','crafting_output','recipe_construction',
  'recipe_nature','recipe_items','recipe_search','recipe_search_bar','recipe_equipment',
  'recipe_book','enchanting_input','enchanting_lapis','furnace_fuel','furnace_ingredient',
  'furnace_output','horse_equip','hotbar','inventory','shulker','trade_ingredient1',
  'trade_ingredient2','trade_result','offhand','compcreate_input','compcreate_output',
  'elemconstruct_output','matreduce_input','matreduce_output','labtable_input','loom_input',
  'loom_dye','loom_material','loom_result','blast_furnace_ingredient','smoker_ingredient',
  'trade2_ingredient1','trade2_ingredient2','trade2_result','grindstone_input',
  'grindstone_additional','grindstone_result','stonecutter_input','stonecutter_result',
  'cartography_input','cartography_additional','cartography_result','barrel','cursor',
  'creative_output','smithing_table_template','crafter','dynamic','registry','recipe_food',
  'recipe_blocks','recipe_furnace_items','reserved_container_a','reserved_container_b',
  'reserved_container_c','reserved_container_d'
]);
const WINDOW_NAMES = new Set([
  'inventory','first','last','offhand','armor','creative','hotbar','fixed_inventory',
  'ui','drop_contents','beacon','trading_output','trading_use_inputs','trading_input_2',
  'trading_input_1','enchant_output','enchant_material','enchant_input','anvil_output',
  'anvil_result','anvil_material','container_input','crafting_use_ingredient',
  'crafting_result','crafting_remove_ingredient','crafting_add_ingredient'
]);

function normalizeWindowId(value) {
  if (value === 0 || value === 'inventory') return 'inventory';
  if (Number.isInteger(value) && value >= -100 && value <= 124) return String(value);
  if (typeof value === 'string' && WINDOW_NAMES.has(value)) return value;
  return null;
}
function normalizeContainer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !CONTAINER_IDS.has(value.container_id)) return null;
  const dynamic = value.dynamic_container_id;
  if (dynamic !== undefined && dynamic !== null &&
      (!Number.isInteger(dynamic) || dynamic < 0 || dynamic > 0xffffffff)) return null;
  return { container_id: value.container_id,
    ...(dynamic === undefined || dynamic === null ? {} : { dynamic_container_id: dynamic }) };
}
function normalizeItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !Number.isInteger(value.network_id) || value.network_id < 0 || value.network_id > MAX_ITEM_ID)
    return null;
  if (value.network_id === 0) return { empty: true, networkId: 0, count: 0, metadata: 0,
    stackId: null, hasStackId: false, blockRuntimeId: 0 };
  if (!Number.isInteger(value.count) || value.count < 1 || value.count > MAX_COUNT ||
      !Number.isInteger(value.metadata) || value.metadata < 0 || value.metadata > 0x7fffffff ||
      typeof value.has_stack_id !== 'boolean') return null;
  if (value.has_stack_id &&
      (!Number.isInteger(value.stack_id) || value.stack_id < -0x80000000 || value.stack_id > 0x7fffffff))
    return null;
  if (!value.has_stack_id && value.stack_id !== undefined) return null;
  if (value.block_runtime_id !== undefined &&
      (!Number.isInteger(value.block_runtime_id) || value.block_runtime_id < 0 || value.block_runtime_id > 0x7fffffff))
    return null;
  return {
    empty: false, networkId: value.network_id, count: value.count, metadata: value.metadata,
    hasStackId: value.has_stack_id, stackId: value.has_stack_id ? value.stack_id : null,
    blockRuntimeId: value.block_runtime_id ?? 0
  };
}
const containerKey = (windowId, container) =>
  windowId + '|' + container.container_id + '|' +
  (container.dynamic_container_id === undefined ? '-' : container.dynamic_container_id);
const copyItem = item => item ? { ...item } : null;

class BedrockInventoryLedger {
  constructor(options = {}) {
    this.clock = options.clock ?? Date.now;
    this.maxAgeMs = options.maxAgeMs ?? MAX_AGE_MS;
    this.windows = new Map();
    this.registry = new Map();
    this.revision = 0;
    this.generation = 0;
    this.lastError = null;
  }
  now() { return this.clock(); }
  reset() {
    this.windows.clear();
    this.registry.clear();
    this.revision = 0;
    this.generation++;
    this.lastError = null;
  }
  observeItemRegistry(packet) {
    const states = packet?.itemstates;
    if (!Array.isArray(states) || states.length > 8192) return false;
    const next = new Map();
    for (const state of states) {
      if (!Number.isInteger(state?.runtime_id) || state.runtime_id < 1 ||
          state.runtime_id > MAX_ITEM_ID || typeof state.name !== 'string' ||
          !/^minecraft:[a-z0-9_./-]{1,80}$/.test(state.name)) continue;
      next.set(state.runtime_id, state.name);
    }
    if (!next.size) return false;
    this.registry = next;
    return true;
  }
  observeContent(packet) {
    const windowId = normalizeWindowId(packet?.window_id);
    const container = normalizeContainer(packet?.container);
    if (windowId === null || !container || !Array.isArray(packet?.input) ||
        packet.input.length > MAX_SLOTS) {
      this.lastError = 'invalid_inventory_content';
      return false;
    }
    const slots = [];
    for (let index = 0; index < packet.input.length; index++) {
      const item = normalizeItem(packet.input[index]);
      if (!item) {
        this.lastError = 'invalid_inventory_item';
        return false;
      }
      slots.push({ slot: index, item, observedAt: this.now(), source: 'full' });
    }
    const key = containerKey(windowId, container);
    const previous = this.windows.get(key);
    this.revision++;
    this.windows.delete(key);
    this.windows.set(key, {
      key, windowId, container, slots, slotCount: slots.length,
      fullObservedAt: this.now(), lastSlotObservedAt: null,
      revision: this.revision, generation: this.generation
    });
    while (this.windows.size > MAX_WINDOWS) this.windows.delete(this.windows.keys().next().value);
    this.lastError = null;
    return true;
  }
  observeSlot(packet) {
    const windowId = normalizeWindowId(packet?.window_id);
    if (windowId === null || !Number.isInteger(packet?.slot) ||
        packet.slot < 0 || packet.slot >= MAX_SLOTS) {
      this.lastError = 'invalid_inventory_slot';
      return false;
    }
    let container = packet.container == null ? null : normalizeContainer(packet.container);
    if (packet.container != null && !container) {
      this.lastError = 'invalid_inventory_container';
      return false;
    }
    let matches = Array.from(this.windows.values()).filter(w => w.windowId === windowId);
    if (container) matches = matches.filter(w => w.container.container_id === container.container_id &&
      w.container.dynamic_container_id === container.dynamic_container_id);
    if (matches.length !== 1) {
      this.lastError = matches.length ? 'ambiguous_inventory_container' : 'inventory_snapshot_required';
      return false;
    }
    const window = matches[0];
    if (packet.slot >= window.slotCount) {
      this.lastError = 'inventory_slot_out_of_range';
      return false;
    }
    const item = normalizeItem(packet.item);
    if (!item) {
      this.lastError = 'invalid_inventory_item';
      return false;
    }
    const now = this.now();
    window.slots[packet.slot] = { slot: packet.slot, item, observedAt: now, source: 'incremental' };
    window.lastSlotObservedAt = now;
    window.revision = ++this.revision;
    this.lastError = null;
    return true;
  }
  getSlot(address, options = {}) {
    const windowId = normalizeWindowId(address?.window_id ?? 0);
    const container = normalizeContainer(address?.container);
    const slot = address?.slot;
    if (windowId === null || !container || !Number.isInteger(slot) || slot < 0 || slot >= MAX_SLOTS)
      return { known: false, reason: 'invalid_slot_address', item: null };
    const window = this.windows.get(containerKey(windowId, container));
    if (!window || slot >= window.slotCount)
      return { known: false, reason: 'inventory_slot_unknown', item: null };
    const observed = window.slots[slot];
    const maxAge = options.maxAgeMs ?? this.maxAgeMs;
    const age = this.now() - observed.observedAt;
    const fresh = age >= 0 && age <= maxAge;
    const fullAge = this.now() - window.fullObservedAt;
    return {
      known: true, fresh, ageMs: age, fullSnapshotFresh: fullAge >= 0 && fullAge <= maxAge,
      windowId: window.windowId, container: { ...window.container }, slot,
      item: copyItem(observed.item), source: observed.source,
      revision: window.revision, generation: window.generation
    };
  }
  playerInventory(options = {}) {
    const candidates = Array.from(this.windows.values()).filter(w =>
      w.windowId === 'inventory' &&
      ['hotbar_and_inventory','inventory'].includes(w.container.container_id));
    if (candidates.length !== 1) return {
      known: false, fresh: false, reason: candidates.length ? 'ambiguous_player_inventory' : 'player_inventory_not_observed',
      observedAt: null, slotCount: 0, occupied: 0, items: []
    };
    const window = candidates[0];
    const age = this.now() - window.fullObservedAt;
    const maxAge = options.maxAgeMs ?? this.maxAgeMs;
    const fresh = age >= 0 && age <= maxAge;
    const items = window.slots.map(entry => ({
      slot: entry.slot, ...copyItem(entry.item), itemName: entry.item.empty
        ? null : this.registry.get(entry.item.networkId) ?? null,
      observedAt: entry.observedAt, source: entry.source
    }));
    return {
      known: true, fresh, reason: fresh ? 'server_inventory_snapshot' : 'player_inventory_snapshot_stale',
      observedAt: window.fullObservedAt, ageMs: age, slotCount: window.slotCount,
      occupied: items.filter(item => !item.empty).length,
      items, revision: window.revision, generation: window.generation
    };
  }
  snapshot() {
    return {
      version: 'minepilot.bedrock-inventory.v1',
      revision: this.revision, generation: this.generation,
      windows: Array.from(this.windows.values()).map(window => ({
        windowId: window.windowId, container: { ...window.container },
        slotCount: window.slotCount,
        occupied: window.slots.filter(entry => !entry.item.empty).length,
        fullObservedAt: window.fullObservedAt,
        lastSlotObservedAt: window.lastSlotObservedAt, revision: window.revision
      })),
      player: this.playerInventory(),
      lastError: this.lastError
    };
  }
}

module.exports = {
  BedrockInventoryLedger, normalizeWindowId, normalizeContainer, normalizeItem,
  MAX_WINDOWS, MAX_SLOTS, MAX_AGE_MS
};
