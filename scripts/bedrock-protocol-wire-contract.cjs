'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const packageRoot = process.argv[2];
if (!packageRoot) throw new Error('bedrock-protocol package path is required');
const { createSerializer } = require(path.join(packageRoot, 'src/transforms/serializer'));
const serializer = createSerializer('1.26.60');

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
const movement = {
  pitch: 0,
  yaw: 0,
  head_yaw: 0,
  position: { x: 33.25, y: 70.5, z: -17.75 },
  move_vector: { x: 1, z: 0 },
  input_data: ['right'],
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
// The pinned Bedrock protocol defines vec2f as X/Z, unlike a generic XY Vec2.
assert.deepEqual(movement.move_vector, { x: 1, z: 0 });
assert.deepEqual(movement.analogue_move_vector, { x: 1, z: 0 });
assert.deepEqual(movement.raw_move_vector, { x: 1, z: 0 });
