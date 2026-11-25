'use strict';

/**
 * Bedrock block runtime-id lookup.
 *
 * Hashed IDs are FNV-1a 32 of little-endian NBT {name, states}. The reverse
 * table is generated from the captured 1.26.60/protocol-2225 vanilla state
 * catalogue. Unknown add-on hashes remain unmapped.
 *
 * Legacy non-hashed numeric IDs use the captured 1.26.60 palette only and
 * are disabled when the server declares unknown blocks, because add-ons may
 * shift the ordered palette.
 */
let cachedNumeric = null;
let cachedHashed = null;

function isProtocol2225(serverVersion) {
  return typeof serverVersion === 'string' &&
    /^1\.26\.(?:60|61|62|65|66)(?:\.|$)/.test(serverVersion);
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
  if (!isProtocol2225(serverVersion) ||
      startGame?.block_network_ids_are_hashes !== true) return null;
  if (cachedHashed) return cachedHashed;

  let data;
  try {
    data = require('./bedrock-vanilla-12660-hashed-states.json');
  } catch {
    return null;
  }
  if (data?.protocolVersion !== 2225 ||
      data.minecraftVersion !== '1.26.60' ||
      !Array.isArray(data.blocks) || data.blocks.length !== 1480 ||
      !Array.isArray(data.runtimeIds) ||
      data.runtimeIds.length !== data.stateCombinationCount ||
      data.stateCombinationCount !== 23948) return null;

  const names = new Set();
  for (const entry of data.blocks) {
    if (!Array.isArray(entry) || entry.length !== 3 ||
        typeof entry[0] !== 'string' ||
        !/^minecraft:[a-z0-9_./-]{1,80}$/.test(entry[0]) ||
        !['block', 'empty', null].includes(entry[1]) ||
        typeof entry[2] !== 'boolean' ||
        names.has(entry[0])) return null;
    names.add(entry[0]);
  }

  const map = new Map();
  for (const entry of data.runtimeIds) {
    if (!Array.isArray(entry) || entry.length !== 2 ||
        !Number.isInteger(entry[0]) ||
        !Number.isInteger(entry[1]) ||
        entry[1] < 0 || entry[1] >= data.blocks.length ||
        map.has(entry[0] >>> 0)) return null;
    const [name, boundingBox, fullCube] = data.blocks[entry[1]];
    // FNV is a signed int32, but the chunk palette carries the same bits as
    // an unsigned varuint32. Normalize before indexing the decoded palette.
    map.set(entry[0] >>> 0, { name, boundingBox, fullCube });
  }

  if (map.size !== data.stateCombinationCount ||
      map.get((-2144268767) >>> 0)?.name !== 'minecraft:stone' ||
      map.get((-604749536) >>> 0)?.name !== 'minecraft:air' ||
      map.get(203547508)?.name !== 'minecraft:brown_mushroom_block' ||
      map.get(1659726445)?.name !== 'minecraft:pointed_dripstone') return null;

  cachedHashed = map;
  return map;
}

function createNumericRuntimeRegistry(startGame, loadMinecraftData = null) {
  const serverVersion = startGame?.server_version ?? startGame?.engine;
  if (typeof serverVersion !== 'string' ||
      !/^1\.26\.60(?:\.|$)/.test(serverVersion) ||
      startGame?.block_network_ids_are_hashes === true) return null;

  if (loadMinecraftData == null && cachedNumeric) {
    const knownNames = new Set([...cachedNumeric.values()].map(v => v.name));
    return hasOnlyKnownBlocks(startGame, knownNames) ? cachedNumeric : null;
  }

  let data;
  try {
    if (typeof loadMinecraftData === 'function') {
      data = loadMinecraftData('bedrock_1.26.60');
    } else {
      const pinned = require('./bedrock-vanilla-12660-states.json');
      if (pinned.protocol !== '1.26.60' || !Array.isArray(pinned.blocks)) return null;
      data = { blocks: pinned.blocks.map(([minStateId, maxStateId, name, boundingBox, fullCube]) => ({
        minStateId, maxStateId, name, boundingBox, fullCube
      })) };
    }
  } catch {
    return null;
  }
  if (!data || !Array.isArray(data.blocks)) return null;

  const map = new Map();
  for (const block of data.blocks) {
    if (!block || !Number.isInteger(block.minStateId) ||
        !Number.isInteger(block.maxStateId) ||
        block.minStateId < 0 || block.maxStateId < block.minStateId ||
        block.maxStateId > 131071 ||
        block.maxStateId - block.minStateId > 8192 ||
        !/^[a-z0-9_./-]{1,80}$/.test(block.name ?? '') ||
        !['block', 'empty', null].includes(block.boundingBox ?? null) ||
        (loadMinecraftData == null && typeof block.fullCube !== 'boolean')) continue;
    for (let id = block.minStateId; id <= block.maxStateId; id++) {
      if (map.has(id)) return null;
      map.set(id, {
        name: 'minecraft:' + block.name,
        boundingBox: block.boundingBox ?? null,
        ...(typeof block.fullCube === 'boolean' ? { fullCube: block.fullCube } : {})
      });
    }
  }
  if (map.size < 1000 ||
      ![...map.values()].some(v => v.name === 'minecraft:air')) return null;

  const knownNames = new Set([...map.values()].map(v => v.name));
  if (!hasOnlyKnownBlocks(startGame, knownNames)) return null;
  if (loadMinecraftData == null) cachedNumeric = map;
  return map;
}

function createVanillaRuntimeRegistry(startGame, loadMinecraftData = null) {
  return startGame?.block_network_ids_are_hashes === true
    ? createHashedRuntimeRegistry(startGame)
    : createNumericRuntimeRegistry(startGame, loadMinecraftData);
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
