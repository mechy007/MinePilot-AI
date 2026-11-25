'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeBedrockBlockId, validateBedrockBlockPosition,
  isBedrockAirBlock, buildBedrockSetBlockCommand
} = require('./bedrock-block-placement.cjs');

test('normalizes only vanilla Bedrock block identifiers', () => {
  assert.equal(normalizeBedrockBlockId('stone'), 'minecraft:stone');
  assert.equal(normalizeBedrockBlockId(' MINECRAFT:oak_planks '), 'minecraft:oak_planks');
  for (const value of ['minecraft:stone; say hello', 'stone dirt', '', null, 'other:block'])
    assert.throws(() => normalizeBedrockBlockId(value));
});

test('enforces integer coordinates and standard build-height limits per dimension', () => {
  assert.deepEqual(validateBedrockBlockPosition({ x: 1, y: -64, z: -1 }, 0),
    { x: 1, y: -64, z: -1 });
  assert.deepEqual(validateBedrockBlockPosition({ x: 1, y: 127, z: 1 }, 1),
    { x: 1, y: 127, z: 1 });
  assert.throws(() => validateBedrockBlockPosition({ x: 0, y: 320, z: 0 }, 0), /bounds/);
  assert.throws(() => validateBedrockBlockPosition({ x: 0, y: -1, z: 0 }, 1), /bounds/);
  assert.throws(() => validateBedrockBlockPosition({ x: 0.5, y: 64, z: 0 }, 0), /integer/);
  assert.throws(() => validateBedrockBlockPosition({ x: 0, y: 64, z: 0 }, 7), /dimension/);
});

test('builds only non-destructive Bedrock setblock commands', () => {
  assert.equal(buildBedrockSetBlockCommand(
    { x: 8, y: 64, z: -3 }, 'oak_planks', 0
  ), 'setblock 8 64 -3 minecraft:oak_planks keep');
  assert.equal(isBedrockAirBlock('minecraft:air'), true);
  assert.equal(isBedrockAirBlock('minecraft:cave_air'), true);
  assert.equal(isBedrockAirBlock('minecraft:stone'), false);
});
