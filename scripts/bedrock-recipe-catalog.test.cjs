'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { BedrockRecipeCatalog } = require('./bedrock-recipe-catalog.cjs');

const registry = { itemstates: [
  { runtime_id: 1, name: 'minecraft:oak_log' },
  { runtime_id: 2, name: 'minecraft:oak_planks' },
  { runtime_id: 3, name: 'minecraft:stick' },
  { runtime_id: 4, name: 'minecraft:diamond' }
] };
const inventory = (items, revision = 10) => ({
  known: true, fresh: true, fullSnapshotFresh: true, registryKnown: true,
  unresolvedItemCount: 0, revision, generation: 1, observedAt: 1000,
  items: Object.entries(items).map(([itemName, count], slot) => ({
    slot, itemName, count, empty: false
  }))
});
const shapeless = (overrides = {}) => ({
  recipe_id: 'minecraft:oak_planks',
  network_id: 42,
  input: [{ type: 'valid', descriptor_type: 'name', name: 'minecraft:oak_log', metadata: 0, count: 1 }],
  output: [{ network_id: 2, count: 4, metadata: 0 }],
  block: 'crafting_table',
  ...overrides
});

test('reads Bedrock crafting_data exact-name recipes and resolves output IDs through item_registry', () => {
  let now = 1000;
  const catalog = new BedrockRecipeCatalog({ clock: () => now });
  assert.equal(catalog.observeItemRegistry(registry), true);
  assert.equal(catalog.observeCraftingData({
    shaped_recipes: [{
      recipe_id: 'minecraft:sticks',
      network_id: 43,
      width: 2, height: 2,
      input: [
        { type: 1, descriptor_type: 'name', name: 'minecraft:oak_planks', metadata: 0 },
        { type: 0, metadata: 32767 },
        { type: 0, metadata: 32767 },
        { type: 1, descriptor_type: 'name', name: 'minecraft:oak_planks', metadata: 0 }
      ],
      output: [{ network_id: 3, count: 4, metadata: 0 }],
      block: 'crafting_table'
    }],
    shapeless_recipes: [shapeless()]
  }), true);
  const snapshot = catalog.snapshot();
  assert.equal(snapshot.total, 2);
  assert.equal(snapshot.supported, 2);
  assert.equal(snapshot.recipes[0].resultItem, 'minecraft:stick');
  assert.deepEqual(snapshot.recipes[0].ingredients, [{ name: 'minecraft:oak_planks', count: 2 }]);
  const plan = catalog.resolve('minecraft:oak_planks', inventory({ 'minecraft:oak_log': 2 }));
  assert.equal(plan.status, 'ready');
  assert.equal(plan.outputExpected, 8);
  assert.equal(plan.recipe.networkId, 42);
});

test('blocks recipes with tags, MoLang, unsupported station, locked condition or 3x3 grid', () => {
  const catalog = new BedrockRecipeCatalog();
  catalog.observeItemRegistry(registry);
  catalog.observeCraftingData({ shaped_recipes: [], shapeless_recipes: [
    shapeless({ network_id: 50, input: [{ type: 1, descriptor_type: 'item_tag', tag: 'minecraft:logs', metadata: 0 }] }),
    shapeless({ network_id: 51, input: [{ type: 1, descriptor_type: 'molang', expression: 'query.test', metadata: 0 }] }),
    shapeless({ network_id: 52, block: 'stonecutter' }),
    shapeless({ network_id: 53, unlocking_requirement: { context: 0 } }),
    shapeless({ network_id: 54, input: Array.from({ length: 5 }, () => ({
      type: 1, descriptor_type: 'name', name: 'minecraft:oak_log', metadata: 0
    })) })
  ] });
  assert.equal(catalog.snapshot().supported, 0);
  assert.equal(catalog.resolve('minecraft:oak_planks', inventory({ 'minecraft:oak_log': 64 })).status, 'blocked');
});

test('requires fresh authoritative inventory, sufficient ingredients and explicit recipe id when ambiguous', () => {
  const catalog = new BedrockRecipeCatalog();
  catalog.observeItemRegistry(registry);
  catalog.observeCraftingData({ shaped_recipes: [], shapeless_recipes: [
    shapeless({ network_id: 42 }),
    shapeless({ recipe_id: 'minecraft:oak_planks_alt', network_id: 43 })
  ] });
  assert.equal(catalog.resolve('minecraft:oak_planks', { ...inventory({ 'minecraft:oak_log': 5 }), fullSnapshotFresh: false }).reason,
    'fresh_resolved_server_inventory_required');
  assert.equal(catalog.resolve('minecraft:oak_planks', inventory({ 'minecraft:oak_log': 2 })).reason,
    'multiple_matching_recipes_require_explicit_recipe_id');
  assert.equal(catalog.resolve('minecraft:oak_planks', inventory({ 'minecraft:oak_log': 0 }), {
    recipeId: 'minecraft:oak_planks'
  }).reason, 'insufficient_observed_ingredients');
  const plan = catalog.resolve('minecraft:oak_planks', inventory({ 'minecraft:oak_log': 3 }), {
    recipeId: 'minecraft:oak_planks', timesCrafted: 2
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.outputExpected, 8);
});

test('clears stale recipe entries when a new Bedrock packet requests a catalogue reset', () => {
  const catalog = new BedrockRecipeCatalog();
  catalog.observeItemRegistry(registry);
  catalog.observeCraftingData({ shaped_recipes: [], shapeless_recipes: [shapeless()] });
  assert.equal(catalog.snapshot().total, 1);
  catalog.observeCraftingData({ shaped_recipes: [], shapeless_recipes: [], clear_recipes: true });
  assert.equal(catalog.snapshot().total, 0);
});
