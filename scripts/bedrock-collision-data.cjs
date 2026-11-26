'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const EXPECTED_STATES = 23960;
let cachedDefaultData = null;

function readGzipJson(directory, name) {
  const file = path.join(directory, name + '.json.gz');
  const bytes = fs.readFileSync(file);
  return JSON.parse(zlib.gunzipSync(bytes).toString('utf8'));
}

function loadBedrockCollisionData(directory = path.join(__dirname, 'bedrock-physics-data')) {
  const defaultDirectory = path.join(__dirname, 'bedrock-physics-data');
  if (cachedDefaultData && path.resolve(directory) === path.resolve(defaultDirectory))
    return cachedDefaultData;
  const blocks = readGzipJson(directory, 'blocks');
  const states = readGzipJson(directory, 'blockStates');
  const collision = readGzipJson(directory, 'blockCollisionShapes');
  const data = buildBedrockCollisionData({ blocks, states, collision });
  if (path.resolve(directory) === path.resolve(defaultDirectory)) cachedDefaultData = data;
  return data;
}

function buildBedrockCollisionData({ blocks, states, collision }, expectedStates = EXPECTED_STATES) {
  if (!Array.isArray(blocks) || !Array.isArray(states) ||
      !collision || !collision.blocks || !collision.shapes) {
    const describe = value => ({
      type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
      length: Array.isArray(value) ? value.length : undefined,
      keys: value && typeof value === 'object' ? Object.keys(value).slice(0, 8) : []
    });
    throw new Error('bedrock_physics_dataset_invalid:' + JSON.stringify({
      blocks: describe(blocks), states: describe(states), collision: describe(collision)
    }));
  }
  if (states.length !== expectedStates)
    throw new Error('bedrock_physics_state_count_mismatch:' + states.length + ':' + expectedStates);

  const blocksByName = Object.create(null);
  const blocksArray = [];
  const profilesByHash = new Map();
  const profilesByStateId = new Map();
  for (const block of blocks) {
    if (!block || typeof block.name !== 'string' || !Number.isInteger(block.id) ||
        !Number.isInteger(block.minStateId) || !Number.isInteger(block.maxStateId) ||
        block.minStateId < 0 || block.maxStateId < block.minStateId ||
        block.maxStateId >= states.length) {
      throw new Error('bedrock_physics_block_registry_invalid');
    }
    const blockName = block.name.replace(/^minecraft:/, '');
    const friction = Number.isFinite(block.friction) ? block.friction : 0.6;
    const entry = { id: block.id, name: blockName, friction };
    if (blocksByName[blockName]) throw new Error('bedrock_physics_duplicate_block');
    blocksByName[blockName] = entry;
    blocksArray.push(entry);

    let shapeIds = collision.blocks[blockName] ?? collision.blocks[block.name];
    const emptyBlock = block.boundingBox === 'empty' || blockName === 'air';
    if (shapeIds === undefined && !emptyBlock)
      throw new Error('bedrock_physics_shape_missing:' + blockName);
    for (let stateId = block.minStateId; stateId <= block.maxStateId; stateId++) {
      const state = states[stateId];
      if (!state || String(state.name).replace(/^minecraft:/, '') !== blockName || !Number.isInteger(state.hash)) {
        throw new Error('bedrock_physics_state_registry_invalid:' + blockName);
      }
      const shapeId = shapeIds === undefined ? null :
        (Array.isArray(shapeIds) ? shapeIds[stateId - block.minStateId] : shapeIds);
      const boxes = shapeId == null || shapeId === -1 ? [] : collision.shapes[String(shapeId)];
      if (!Array.isArray(boxes) || boxes.some(box =>
        !Array.isArray(box) || box.length !== 6 || box.some(v => !Number.isFinite(v)))) {
        throw new Error('bedrock_physics_collision_shape_invalid:' + blockName);
      }
      const properties = Object.create(null);
      for (const [key, raw] of Object.entries(state.states ?? {})) {
        properties[key] = raw && typeof raw === 'object' && Object.hasOwn(raw, 'value')
          ? raw.value : raw;
      }
      const hash = state.hash >>> 0;
      if (profilesByHash.has(hash)) throw new Error('bedrock_physics_duplicate_state_hash');
      const profile = {
        id: block.id,
        name: blockName,
        boundingBox: block.boundingBox ?? (boxes.length ? 'block' : 'empty'),
        friction,
        shapes: boxes,
        properties,
        metadata: Number(properties.liquid_depth ?? 0),
        isWaterlogged: properties.waterlogged_bit === 1 || properties.waterlogged === true
      };
      profilesByHash.set(hash, profile);
      profilesByStateId.set(stateId, profile);
    }
  }
  if (profilesByHash.size !== expectedStates || !blocksByName.air) {
    throw new Error('bedrock_physics_registry_incomplete');
  }
  return {
    registry: { blocksByName, blocksArray },
    profilesByHash,
    profilesByStateId,
    stateCount: profilesByHash.size,
    blockCount: blocksArray.length
  };
}

module.exports = { loadBedrockCollisionData, buildBedrockCollisionData, EXPECTED_STATES };
