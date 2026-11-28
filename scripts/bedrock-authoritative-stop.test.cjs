'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BedrockMovementController } = require('./bedrock-movement-controller.cjs');
const { buildBedrockCollisionData } = require('./bedrock-collision-data.cjs');

function fixture() {
  let now = 1000;
  let pulse = null;
  const packets = [];
  const client = { queue: (name, packet) => packets.push({ name, packet }) };
  const terrain = {
    dimension: 0,
    registry: new Map([[100, { name: 'minecraft:air' }], [101, { name: 'minecraft:stone' }]]),
    blockId(dimension, x, y, z) { return y < 0 ? 101 : 100; }
  };
  const collisionData = buildBedrockCollisionData({
    blocks: [
      { id: 0, name: 'air', minStateId: 0, maxStateId: 0, friction: 0.6, boundingBox: 'empty' },
      { id: 1, name: 'stone', minStateId: 1, maxStateId: 1, friction: 0.6, boundingBox: 'block' }
    ],
    states: [
      { name: 'air', hash: 100, states: {} },
      { name: 'stone', hash: 101, states: {} }
    ],
    collision: { blocks: { air: 0, stone: 1 },
      shapes: { '0': [], '1': [[0, 0, 0, 1, 1, 1]] } }
  }, 2);
  const timers = {
    setInterval(callback) { pulse = callback; return 1; },
    clearInterval() { pulse = null; }
  };
  const movement = new BedrockMovementController(client, {
    clock: () => now, timers, terrain, collisionData
  });
  const world = {
    closed: false, spawned: true, self: { runtimeId: 123 },
    position: { x: 0.5, y: 1.62, z: 0.5 }, yaw: 0, pitch: 0,
    dimension: 0, movementAuthority: 1, serverTick: 100n,
    serverTickObservedAt: now, blockNetworkIdsAreHashes: true, terrain,
    receivedChunks: new Map([['0:0', true]])
  };
  return {
    packets, movement, world,
    start() { return movement.startPresence(world); },
    hold() { return movement.runManualHold(world, { mode: 'forward', ticks: 8 }); },
    pulse() { now += 50; pulse?.(); },
    setNow(value) { now = value; }
  };
}

test('manual stop emits a neutral authoritative-input frame through the live movement queue', () => {
  const f = fixture();
  assert.equal(f.start(), true);
  assert.equal(f.hold().status, 'accepted');
  f.pulse();
  const moving = f.packets.at(-1);
  assert.equal(moving.name, 'player_auth_input');
  assert.ok(moving.packet.input_data.includes('up'));
  assert.ok(Math.hypot(moving.packet.move_vector.x, moving.packet.move_vector.z) > 0.01);

  f.world.position = { x: 0.5, y: 1.62, z: 0.42 };
  f.movement.observeServerPosition(f.world.position, 1050);
  f.movement.releaseManual();
  f.pulse();
  const neutral = f.packets.at(-1);
  assert.equal(neutral.name, 'player_auth_input');
  assert.deepEqual(neutral.packet.move_vector, { x: 0, z: 0 });
  assert.equal(neutral.packet.input_data.includes('up'), false);
  assert.ok(neutral.packet.tick > moving.packet.tick);
  f.movement.stopPresence('session_closed');
});

test('closed-world shutdown stops the queue without inventing another movement frame', () => {
  const f = fixture();
  assert.equal(f.start(), true);
  assert.equal(f.hold().status, 'accepted');
  f.pulse();
  assert.equal(f.packets.length, 1);
  f.world.closed = true;
  f.movement.stopPresence('session_closed');
  f.movement.stopPresence('session_closed');
  assert.equal(f.packets.length, 1);
});
