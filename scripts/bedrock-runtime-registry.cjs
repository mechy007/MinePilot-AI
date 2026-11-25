'use strict';

/**
 * Bedrock 1.26.60+ block runtime-id lookup.
 *
 * Hashed worlds use FNV-1a 32 over little-endian NBT {name, states}; the
 * version-pinned reverse map was generated from JSPrismarine's captured
 * v2225 vanilla block-state catalogue. Unrecognized add-on blocks remain
 * unknown: this module never guesses a collision shape.
 *
 * Non-hashed worlds use the bundled minecraft-data v1.26.60 numeric palette.
 * A server-provided block name outside that palette invalidates the static
 * numeric ordering, so those worlds fail closed.
 */
let cachedNumeric = null;
let cachedHashed = null;

function supportedProtocolFamily(serverVersion) {
  return typeof serverVersion === 'string' &&
    /^1\\.26\\.(?:60|61|62|65|66)(?:\\.|$)/.test(serverVersion);
}

function hasOnlyKnownBlocks(startGame, knownNames) {
  const properties = startGame?.block_properties;
  if (properties == null) return true;
  if (!Array.isArray(properties)) return false;
  return properties.every(property =>
    property && typeof property.name === 'string' && knownNames.has(property.name)
  );
}

function createHashedRuntimeRegistry(startGame) {
  const serverVersion = startGame?.server_version ?? startGame?.engine;
  if (!supportedProtocolFamily(serverVersion) ||
      startGame?.block_network_ids_are_hashes !== true) return null;

  let data;
  try {
    data = require('./bedrock-vanilla-12660-hashed-states.json');
  } catch {
    return null;
  }
  if (data?.protocolVersion !== 2225 ||
      !['1.26.60'].includes(data.minecraftVersion) ||
      !Array.isArray(data.blocks) || data.blocks.length !== 1480 ||
      !Array.isArray(data.runtimeIds) ||
      data.runtimeIds.length !== data.stateCombinationCount) return null;

  const knownNames = new Set(data.blocks.map(entry =>
    Array.isArray(entry) && typeof entry[0] === 'string' ? entry[0] : ''
  ));
  if (knownNames.size !== data.blocks.length ||
      !hasOnlyKnownBlocks(startGame, knownNames)) return null;

  if (!cachedHashed) {
    const map = new Map();
    for (const entry of data.runtimeIds) {
      if (!Array.isArray(entry) || entry.length !== 2 ||
          !Number.isInteger(entry[0]) || !Number.isInteger(entry[1]) ||
          entry[1] < 0 || entry[1] >= data.blocks.length || map.has(entry[0])) {
        return null;
      }
      const [name, boundingBox] = data.blocks[entry[1]];
      if (typeof name !== 'string' ||
          !['block', 'empty', null].includes(boundingBox)) return null;
      map.set(entry[0], { name, boundingBox });
    }
    if (map.size !== data.stateCombinationCount ||
        map.get(-2144268767)?.name !== 'minecraft:stone' ||
        map.get(-604749536)?.name !== 'minecraft:air') return null;
    cachedHashed = map;
  }
  return cachedHashed;
}

function createNumericRuntimeRegistry(startGame, loadMinecraftData = null) {
  const serverVersion = startGame?.server_version ?? startGame?.engine;
  if (!supportedProtocolFamily(serverVersion) ||
      startGame?.block_network_ids_are_hashes === true) return null;

  let data;
  try {
    if (typeof loadMinecraftData === 'function') {
      // Test-only injection permits malformed/foreign registry fixtures.
      data = loadMinecraftData('bedrock_1.26.60');
    } else {
      const pinned = require('./bedrock-vanilla-12660-states.json');
      if (pinned.protocol !== '1.26.60' || !Array.isArray(pinned.blocks)) return null;
      data = { blocks: pinned.blocks.map(([minStateId, maxStateId, name, boundingBox]) => ({
        minStateId, maxStateId, name, boundingBox
      })) };
    }
  } catch {
    return null;
  }
  if (!data || !Array.isArray(data.blocks)) return null;

  const knownNames = new Set(data.blocks
    .filter(block => block && typeof block.name === 'string')
    .map(block => 'minecraft:' + block.name));
  // A non-hashed server builds one combined ordered palette. Any block not
  // in the captured vanilla set can shift every later runtime ID.
  if (!hasOnlyKnownBlocks(startGame, knownNames)) return null;

  const map = new Map();
  for (const block of data.blocks) {
    if (!block || !Number.isInteger(block.minStateId) ||
        !Number.isInteger(block.maxStateId) ||
        block.minStateId < 0 || block.maxStateId < block.minStateId ||
        block.maxStateId > 131071 ||
        block.maxStateId - block.minStateId > 8192 ||
        !/^[a-z0-9_./-]{1,80}$/.test(block.name ?? '') ||
        !['block', 'empty', null].includes(block.boundingBox ?? null)) continue;
    for (let id = block.minStateId; id <= block.maxStateId; id++) {
      if (map.has(id)) return null;
      map.set(id, { name: 'minecraft:' + block.name, boundingBox: block.boundingBox ?? null });
    }
  }
  if (map.size < 1000 || ![...map.values()].some(v => v.name === 'minecraft:air')) return null;
  return map;
}

function createVanillaRuntimeRegistry(startGame, loadMinecraftData = null) {
  if (startGame?.block_network_ids_are_hashes === true) {
    // Hash IDs can be reversed only for the captured 1.26.60 vanilla state
    // catalogue. Add-on block names not present in that capture disable
    // terrain classification instead of borrowing an unrelated hash match.
    return createHashedRuntimeRegistry(startGame);
  }
  return createNumericRuntimeRegistry(startGame, loadMinecraftData);
}

function clearRuntimeRegistryCache() {
  cachedNumeric = null;
  cachedHashed = null;
}

module.exports = {
  createVanillaRuntimeRegistry,
  createHashedRuntimeRegistry,
  createNumericRuntimeRegistry,
  clearRuntimeRegistryCache
};
