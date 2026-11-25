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

const { buildInputPacket } = require('./bedrock-player-input.cjs');
const movement = buildInputPacket(
  { x: 33.25, y: 70.5, z: -17.75 }, 0, 101n, true,
  { moveVector: { x: 1, z: 0 }, inputFlag: 13 }
);
const input = serializer.createPacketBuffer({
  name: 'player_auth_input',
  params: movement
});
assert.ok(Buffer.isBuffer(input));
assert.ok(input.length > 20, 'manual strafe pulse is serializer-compatible');
assert.deepEqual(movement.move_vector, { x: 1, y: 0 });
assert.deepEqual(movement.analogue_move_vector, { x: 1, y: 0 });
assert.deepEqual(movement.raw_move_vector, { x: 1, y: 0 });
