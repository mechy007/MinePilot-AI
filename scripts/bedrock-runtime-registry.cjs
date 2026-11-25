'use strict';

/**
 * Minecraft-data 1.26.60 vanilla block runtime-id resolution.
 * Only trust an exact version match and no server-supplied custom palette.
 * This stage does not guess IDs from a block name or a chunk header.
 */
let cached = null;
function createVanillaRuntimeRegistry(startGame, loadMinecraftData = null) {
  const engine = startGame?.engine;
  if (typeof engine === 'string' && engine.length &&
      !/^1\.26\.60(?:\.|$)/.test(engine)) return null;
  // Hashed block network IDs cannot be resolved by the pinned vanilla
  // numeric-state table; never apply static IDs to those worlds.
  if (startGame?.block_network_ids_are_hashes === true) return null;
  const custom = startGame?.block_properties;
  if (Array.isArray(custom) && custom.length) return null;
  if (cached) return cached;
  let data;
  try {
    if (typeof loadMinecraftData === 'function') {
      // Test-only injection permits malformed/foreign registry fixtures.
      data=loadMinecraftData('bedrock_1.26.60');
    } else {
      // This pinned JSON is extracted from minecraft-data's 1.26.60
      // Bedrock blocks.json. Runtime NPM version aliases can differ, so
      // resolve state ranges from the bundled artifact deterministically.
      const pinned=require('./bedrock-vanilla-12660-states.json');
      if(pinned.protocol!=='1.26.60' || !Array.isArray(pinned.blocks))return null;
      data={blocks:pinned.blocks.map(([minStateId,maxStateId,name,boundingBox])=>({
        minStateId,maxStateId,name,boundingBox
      }))};
    }
  } catch { return null; }
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
