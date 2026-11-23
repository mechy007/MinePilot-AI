'use strict';

/**
 * Minecraft-data 1.26.60 vanilla block runtime-id resolution.
 * Only trust an exact version match and no server-supplied custom palette.
 * This stage does not guess IDs from a block name or a chunk header.
 */
let cached = null;
function createVanillaRuntimeRegistry(startGame, loadMinecraftData = require('minecraft-data')) {
  const engine = startGame?.engine;
  if (typeof engine === 'string' && engine.length &&
      !/^1\.26\.60(?:\.|$)/.test(engine)) return null;
  const custom = startGame?.block_properties;
  if (Array.isArray(custom) && custom.length) return null;
  if (cached) return cached;
  let data;
  try { data = loadMinecraftData('bedrock_1.26.60'); } catch { return null; }
  if (!data || !Array.isArray(data.blocks)) return null;
  const map = new Map();
  // Bedrock block palette has many states per block; minecraft-data enumerates
  // their network state IDs as minStateId..maxStateId, not block numeric IDs.
  for(const block of data.blocks) {
    if(!block || !Number.isInteger(block.minStateId) ||
       !Number.isInteger(block.maxStateId) ||
       block.minStateId<0 || block.maxStateId<block.minStateId ||
       block.maxStateId>131071 ||
       block.maxStateId-block.minStateId>8192 ||
       !/^[a-z0-9_./-]{1,80}$/.test(block.name??''))continue;
    for(let id=block.minStateId;id<=block.maxStateId;id++)
      map.set(id,{name:'minecraft:'+block.name,boundingBox:block.boundingBox??null});
  }
  // A few thousand states should resolve. An incomplete file would be worse
  // than declining collision classification.
  if(map.size<1000 || !Array.from(map.values()).some(v=>v.name==='minecraft:air'))
    return null;
  cached=map;
  return map;
}
function clearRuntimeRegistryCache(){cached=null;}
module.exports={createVanillaRuntimeRegistry,clearRuntimeRegistryCache};
