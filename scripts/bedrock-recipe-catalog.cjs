'use strict';

// Bedrock 1.26.60 recipe catalogue. Only exact-name, single-output recipes
// which fit the player's 2x2 grid are offered to the autonomous crafting path.
// Tag/MoLang ingredients, table-only 3x3 recipes and specialist stations remain
// visible as unsupported metadata, never guessed or dispatched.

const MAX_RECIPES = 20000;
const MAX_RECIPE_ID = 128;
const ITEM_NAME = /^minecraft:[a-z0-9_./-]{1,80}$/;
const RECIPE_ID = /^[a-zA-Z0-9_.:/-]{1,128}$/;

function validRecipeId(value) {
  return typeof value === 'string' && value.length <= MAX_RECIPE_ID && RECIPE_ID.test(value);
}

function normalizeIngredient(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { supported: false, reason: 'invalid_recipe_ingredient' };
  if (value.type === 0 || value.type === 'invalid' || value.descriptor_type === 'empty')
    return { empty: true, supported: true };
  if (value.type !== 1 && value.type !== 'valid')
    return { supported: false, reason: 'unknown_ingredient_type' };
  if (value.descriptor_type !== 'name' || typeof value.name !== 'string' ||
      !ITEM_NAME.test(value.name))
    return { supported: false, reason: 'ingredient_must_be_an_exact_vanilla_item_name' };
  // Non-zero metadata describes variants; do not guess which variant the
  // recipe or inventory transaction intends to consume.
  if (value.metadata !== undefined && value.metadata !== 0)
    return { supported: false, reason: 'item_variant_metadata_not_supported' };
  const count = value.count === undefined ? 1 : value.count;
  if (!Number.isInteger(count) || count < 1 || count > 64)
    return { supported: false, reason: 'invalid_ingredient_count' };
  return { supported: true, name: value.name, count };
}

function normalizeRecipe(recipe, kind, registry) {
  if (!recipe || typeof recipe !== 'object' || !validRecipeId(recipe.recipe_id) ||
      !Number.isInteger(recipe.network_id) || recipe.network_id < 1 ||
      recipe.network_id > 0x7fffffff)
    return { supported: false, reason: 'invalid_recipe_identity' };
  const inputs = Array.isArray(recipe.input) ? recipe.input : null;
  const outputs = Array.isArray(recipe.output) ? recipe.output : null;
  if (!inputs || inputs.length < 1 || inputs.length > 64 || !outputs || outputs.length !== 1)
    return { supported: false, reason: 'recipe_must_have_bounded_inputs_and_one_output' };
  if (recipe.block !== 'crafting_table')
    return { supported: false, reason: 'recipe_requires_non_player_crafting_station' };
  const unlocking = recipe.unlocking_requirement;
  const unlockContext = unlocking?.context;
  if (unlocking && unlockContext !== 1 && unlockContext !== 'always_unlocked')
    return { supported: false, reason: 'recipe_unlocking_requirement_not_proven' };

  if (kind === 'shaped') {
    if (!Number.isInteger(recipe.width) || !Number.isInteger(recipe.height) ||
        recipe.width < 1 || recipe.height < 1 || recipe.width > 2 || recipe.height > 2 ||
        recipe.width * recipe.height !== inputs.length)
      return { supported: false, reason: 'recipe_does_not_fit_player_two_by_two_grid' };
  } else if (kind === 'shapeless') {
    if (inputs.length > 4)
      return { supported: false, reason: 'recipe_exceeds_player_two_by_two_grid' };
  } else {
    return { supported: false, reason: 'recipe_kind_not_supported' };
  }

  const ingredients = [];
  for (const input of inputs) {
    const normalized = normalizeIngredient(input);
    if (!normalized.supported) return normalized;
    if (!normalized.empty) ingredients.push(normalized);
  }
  if (!ingredients.length) return { supported: false, reason: 'recipe_has_no_exact_ingredients' };

  const output = outputs[0];
  if (!output || !Number.isInteger(output.network_id) || output.network_id < 1 ||
      !Number.isInteger(output.count) || output.count < 1 || output.count > 64)
    return { supported: false, reason: 'invalid_recipe_output' };
  if (output.metadata !== undefined && output.metadata !== 0)
    return { supported: false, reason: 'output_variant_metadata_not_supported' };
  const resultItem = registry.get(output.network_id);
  if (!resultItem) return { supported: false, reason: 'recipe_output_item_registry_unresolved' };

  const totals = new Map();
  for (const item of ingredients) totals.set(item.name, (totals.get(item.name) ?? 0) + item.count);
  return {
    supported: true,
    id: recipe.recipe_id,
    networkId: recipe.network_id,
    kind,
    station: recipe.block,
    resultItem,
    resultCount: output.count,
    ingredients: Array.from(totals, ([name, count]) => ({ name, count }))
  };
}

function sumItem(inventory, itemName) {
  return (inventory?.items ?? []).reduce((sum, item) =>
    item?.empty === true || item?.itemName !== itemName ? sum : sum + (Number.isInteger(item.count) ? item.count : 0), 0);
}

function validateInventory(inventory) {
  return inventory?.known === true && inventory.fresh === true &&
    inventory.fullSnapshotFresh === true && inventory.registryKnown === true &&
    inventory.unresolvedItemCount === 0 && Array.isArray(inventory.items) &&
    Number.isInteger(inventory.revision) && Number.isFinite(inventory.observedAt);
}

class BedrockRecipeCatalog {
  constructor(options = {}) {
    this.clock = options.clock ?? Date.now;
    this.registry = new Map();
    this.rawRecipes = [];
    this.recipes = [];
    this.observedAt = null;
    this.generation = 0;
    this.lastError = null;
  }

  reset() {
    this.registry.clear();
    this.rawRecipes = [];
    this.recipes = [];
    this.observedAt = null;
    this.generation++;
    this.lastError = null;
  }

  observeItemRegistry(packet) {
    const states = packet?.itemstates;
    if (!Array.isArray(states) || states.length > 8192) return false;
    const next = new Map();
    for (const state of states) {
      if (!Number.isInteger(state?.runtime_id) || state.runtime_id < 1 ||
          state.runtime_id > 32767 || typeof state.name !== 'string' ||
          !ITEM_NAME.test(state.name)) continue;
      next.set(state.runtime_id, state.name);
    }
    if (!next.size) return false;
    this.registry = next;
    this.rebuild();
    return true;
  }

  observeCraftingData(packet) {
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return false;
    const shaped = packet.shaped_recipes ?? [];
    const shapeless = packet.shapeless_recipes ?? [];
    if (!Array.isArray(shaped) || !Array.isArray(shapeless) ||
        shaped.length + shapeless.length > MAX_RECIPES) {
      this.lastError = 'invalid_or_oversized_crafting_data';
      return false;
    }
    if (packet.clear_recipes === true) this.rawRecipes = [];
    this.rawRecipes = [
      ...this.rawRecipes.filter(item => !this.isReplaced(item, shaped, shapeless)),
      ...shaped.map(recipe => ({ kind: 'shaped', recipe })),
      ...shapeless.map(recipe => ({ kind: 'shapeless', recipe }))
    ].slice(-MAX_RECIPES);
    this.observedAt = this.clock();
    this.lastError = null;
    this.rebuild();
    return true;
  }

  isReplaced(existing, shaped, shapeless) {
    const ids = new Set([...shaped, ...shapeless].map(item => item?.network_id));
    return ids.has(existing.recipe?.network_id);
  }

  rebuild() {
    this.recipes = this.rawRecipes.map(({ recipe, kind }) =>
      normalizeRecipe(recipe, kind, this.registry));
  }

  resolve(resultItem, inventory, options = {}) {
    if (typeof resultItem !== 'string' || !ITEM_NAME.test(resultItem))
      return { status: 'rejected', reason: 'valid_result_item_required' };
    const times = options.timesCrafted ?? 1;
    if (!Number.isInteger(times) || times < 1 || times > 8)
      return { status: 'rejected', reason: 'craft_count_must_be_between_1_and_8' };
    if (!validateInventory(inventory))
      return { status: 'blocked', reason: 'fresh_resolved_server_inventory_required' };
    const candidates = this.recipes.filter(recipe => recipe.supported && recipe.resultItem === resultItem);
    const chosen = options.recipeId
      ? candidates.filter(recipe => recipe.id === options.recipeId)
      : candidates;
    if (!chosen.length) return { status: 'blocked', reason: 'no_supported_server_recipe_for_result_item' };
    if (chosen.length > 1)
      return { status: 'blocked', reason: 'multiple_matching_recipes_require_explicit_recipe_id' };
    const recipe = chosen[0];
    const missing = recipe.ingredients
      .map(item => ({ name: item.name, required: item.count * times, available: sumItem(inventory, item.name) }))
      .filter(item => item.available < item.required);
    if (missing.length) return { status: 'blocked', reason: 'insufficient_observed_ingredients', missing };
    return {
      status: 'ready',
      recipe: { ...recipe, ingredients: recipe.ingredients.map(item => ({ ...item })) },
      timesCrafted: times,
      outputExpected: recipe.resultCount * times,
      outputBefore: sumItem(inventory, recipe.resultItem),
      ingredientBefore: Object.fromEntries(recipe.ingredients.map(item => [item.name, sumItem(inventory, item.name)])),
      inventoryRevision: inventory.revision,
      inventoryGeneration: inventory.generation
    };
  }

  snapshot(limit = 64) {
    const now = this.clock();
    const recipes = this.recipes.slice(0, Math.max(0, Math.min(256, limit))).map(recipe => ({ ...recipe,
      ...(Array.isArray(recipe.ingredients) ? { ingredients: recipe.ingredients.map(item => ({ ...item })) } : {})
    }));
    const supported = this.recipes.filter(recipe => recipe.supported).length;
    return {
      version: 'minepilot.bedrock-recipes.v1',
      generation: this.generation,
      observedAt: this.observedAt,
      ageMs: this.observedAt === null ? null : Math.max(0, now - this.observedAt),
      total: this.recipes.length,
      supported,
      unsupported: this.recipes.length - supported,
      recipes
    };
  }
}

module.exports = {
  BedrockRecipeCatalog,
  normalizeRecipe,
  normalizeIngredient,
  validateInventory,
  sumItem
};
