'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const packageRoot = process.argv[2];
if (!packageRoot) throw new Error('bedrock-protocol package path is required');
const { createSerializer } = require(path.join(packageRoot, 'src/transforms/serializer'));
const serializer = createSerializer('1.26.60');
const { buildFlags } = require('../vendor/bedboo-physics/lib/physics/input');

const subchunkRequest = serializer.createPacketBuffer({
  name: 'subchunk_request',
  params: {
    dimension: 0,
    requests: [
      { x: 0, y: -2, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 2, z: 0 }
    ],
    origin: { x: 2, y: 4, z: -2 }
  }
});
assert.ok(Buffer.isBuffer(subchunkRequest));
assert.ok(subchunkRequest.length > 10, 'subchunk request has a non-empty wire payload');

// Bedrock 1.26.60 PlayerAuthInput shape emitted by the physics controller.
// Position and delta are simulator output, not a fixed-step prediction.
const previousInput = {
  control: { forward: false, back: false, left: false, right: false,
    jump: false, sprint: false, sneak: false },
  sprinting: false, sneaking: false, swimming: false, gliding: false, flying: false
};
const currentInput = {
  control: { forward: true, back: true, left: true, right: true,
    jump: true, sprint: true, sneak: true },
  jumped: true, sprinting: true, sneaking: true, swimming: true, gliding: true,
  flying: true, collidedVertically: true, collidedHorizontally: true
};
const movementFlags = buildFlags(previousInput, currentInput);
const movement = {
  pitch: 0,
  yaw: 0,
  head_yaw: 0,
  position: { x: 33.25, y: 70.5, z: -17.75 },
  move_vector: { x: 1, z: 0 },
  input_data: movementFlags,
  input_mode: 'touch',
  play_mode: 'normal',
  interaction_model: 'crosshair',
  interact_rotation: { x: 0, z: 0 },
  tick: 101n,
  delta: { x: 0, y: 0, z: 0 },
  analogue_move_vector: { x: 1, z: 0 },
  camera_orientation: { x: 0, y: 0, z: 1 },
  raw_move_vector: { x: 1, z: 0 }
};
const input = serializer.createPacketBuffer({
  name: 'player_auth_input',
  params: movement
});
assert.ok(Buffer.isBuffer(input));
assert.ok(input.length > 20, 'manual strafe pulse is serializer-compatible');
assert.ok(movementFlags.includes('up') && movementFlags.includes('right'));
assert.ok(movementFlags.includes('jumping') && movementFlags.includes('sprinting'));
assert.ok(movementFlags.includes('sneaking') && movementFlags.includes('start_swimming'));
assert.ok(movementFlags.includes('start_gliding') && movementFlags.includes('start_flying'));
assert.ok(movementFlags.includes('vertical_collision') && movementFlags.includes('horizontal_collision'));
// The pinned Bedrock protocol defines vec2f as X/Z, unlike a generic XY Vec2.
assert.deepEqual(movement.move_vector, { x: 1, z: 0 });
assert.deepEqual(movement.analogue_move_vector, { x: 1, z: 0 });
assert.deepEqual(movement.raw_move_vector, { x: 1, z: 0 });
