'use strict';

// Safe, Bedrock-only block placement command construction.
// Placement is intentionally limited to one vanilla block and the Bedrock
// "keep" mode: it can fill an air cell but cannot replace an existing block.

const DIMENSION_HEIGHTS = Object.freeze({
  0: Object.freeze({ minY: -64, maxY: 319 }), // Overworld
  1: Object.freeze({ minY: 0, maxY: 127 }),   // Nether
  2: Object.freeze({ minY: 0, maxY: 255 })    // End
});

function normalizeBedrockBlockId(value) {
  if (typeof value !== 'string') throw new TypeError('block_id_required');
  const raw = value.trim().toLowerCase();
  const namespaced = raw.includes(':') ? raw : 'minecraft:' + raw;
  if (!/^minecraft:[a-z0-9_./-]{1,80}$/.test(namespaced))
    throw new TypeError('vanilla_bedrock_block_id_required');
  return namespaced;
}

function validateBedrockBlockPosition(position, dimension) {
  if (!position || typeof position !== 'object' || Array.isArray(position) ||
      !['x', 'y', 'z'].every(key => Number.isSafeInteger(position[key])))
    throw new TypeError('integer_block_position_required');
  const bounds = DIMENSION_HEIGHTS[dimension];
  if (!bounds) throw new RangeError('unsupported_bedrock_dimension');
  if (Math.abs(position.x) > 30000000 || Math.abs(position.z) > 30000000 ||
      position.y < bounds.minY || position.y > bounds.maxY)
    throw new RangeError('block_position_out_of_dimension_bounds');
  return { x: position.x, y: position.y, z: position.z };
}

function isBedrockAirBlock(blockName) {
  return blockName === 'minecraft:air' ||
    blockName === 'minecraft:cave_air' ||
    blockName === 'minecraft:void_air';
}

function buildBedrockSetBlockCommand(position, blockId, dimension) {
  const point = validateBedrockBlockPosition(position, dimension);
  const block = normalizeBedrockBlockId(blockId);
  return 'setblock ' + point.x + ' ' + point.y + ' ' + point.z + ' ' + block + ' keep';
}

module.exports = {
  DIMENSION_HEIGHTS,
  normalizeBedrockBlockId,
  validateBedrockBlockPosition,
  isBedrockAirBlock,
  buildBedrockSetBlockCommand
};
