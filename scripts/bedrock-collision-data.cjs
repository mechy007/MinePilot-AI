'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const EXPECTED_STATES = 23948;

function readGzipJson(directory, name) {
  const file = path.join(directory, name + '.json.gz');
  const bytes = fs.readFileSync(file);
  return JSON.parse(zlib.gunzipSync(bytes).toString('utf8'));
}

function loadBedrockCollisionData(directory = path.join(__dirname, 'bedrock-physics-data')) {
  const blocks = readGzipJson(directory, 'blocks');
  const states = readGzipJson(directory, 'blockStates');
  const collision = readGzipJson(directory, 'blockCollisionShapes');
  return buildBedrockCollisionData({ blocks, states, collision });
}

function buildBedrockCollisionData({ blocks, states, collision }, expectedStates = EXPECTED_STATES) {
  if (!Array.isArray(blocks) || !Array.isArray(states) || states.length !== expectedStates ||
      !collision || !collision.blocks || !collision.shapes) {
    throw new Error('bedrock_physics_data_invalid');
  }

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
    const friction = Number.isFinite(block.friction) ? block.friction : 0.6;
    const entry = { id: block.id, name: block.name, friction };
    if (blocksByName[block.name]) throw new Error('bedrock_physics_duplicate_block');
    blocksByName[block.name] = entry;
    blocksArray.push(entry);

    const shapeIds = collision.blocks[block.name];
    if (shapeIds === undefined) throw new Error('bedrock_physics_shape_missing:' + block.name);
    for (let stateId = block.minStateId; stateId <= block.maxStateId; stateId++) {
      const state = states[stateId];
      if (!state || state.name !== block.name || !Number.isInteger(state.hash)) {
        throw new Error('bedrock_physics_state_registry_invalid:' + block.name);
      }
      const shapeId = Array.isArray(shapeIds) ? shapeIds[stateId - block.minStateId] : shapeIds;
      const boxes = collision.shapes[String(shapeId)];
      if (!Array.isArray(boxes) || boxes.some(box =>
        !Array.isArray(box) || box.length !== 6 || box.some(v => !Number.isFinite(v)))) {
        throw new Error('bedrock_physics_collision_shape_invalid:' + block.name);
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
        name: block.name,
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
