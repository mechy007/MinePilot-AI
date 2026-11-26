'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('../vendor/bedboo-physics/lib/vec3');
const { Physics, PlayerState } = require('../vendor/bedboo-physics/lib/physics');
const { buildBedrockCollisionData } = require('./bedrock-collision-data.cjs');
const { BedrockMovementController } = require('./bedrock-movement-controller.cjs');

function fixture() {
  const blocks = [
    { id: 0, name: 'air', minStateId: 0, maxStateId: 0, friction: 0.6, boundingBox: 'empty' },
    { id: 1, name: 'stone', minStateId: 1, maxStateId: 1, friction: 0.6, boundingBox: 'block' }
  ];
  const states = [
    { name: 'air', hash: 100, states: {} },
    { name: 'stone', hash: 101, states: {} }
  ];
  const collision = {
    blocks: { air: 0, stone: 1 },
    shapes: { '0': [], '1': [[0, 0, 0, 1, 1, 1]] }
  };
  return buildBedrockCollisionData({ blocks, states, collision }, 2);
}

function blockAt(profile, x, y, z) {
  return {
    name: profile.name, type: profile.id, friction: profile.friction,
    boundingBox: profile.boundingBox, shapes: profile.shapes, metadata: 0,
    isWaterlogged: false, _properties: {}, getProperties: () => ({}),
    position: new Vec3(x, y, z)
  };
}

test('collision registry maps hashed Bedrock states to exact collision boxes', () => {
  const data = fixture();
  assert.equal(data.stateCount, 2);
  assert.equal(data.blockCount, 2);
  assert.equal(data.profilesByHash.get(100).name, 'air');
  assert.deepEqual(data.profilesByHash.get(100).shapes, []);
  assert.deepEqual(data.profilesByHash.get(101).shapes, [[0, 0, 0, 1, 1, 1]]);
  assert.equal(data.registry.blocksByName.stone.id, 1);
});

test('Bedrock physics engine applies directional movement and gravity against loaded terrain', () => {
  const data = fixture();
  const world = {
    getBlock(pos) {
      const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
      return y < 0 ? blockAt(data.profilesByHash.get(101), x, y, z)
        : blockAt(data.profilesByHash.get(100), x, y, z);
    }
  };
  const entity = {
    position: new Vec3(0, 0, 0), velocity: new Vec3(0, 0, 0), onGround: true,
    isInWater: false, isInLava: false, isInWeb: false,
    isCollidedHorizontally: false, isCollidedVertically: false, elytraFlying: false,
    attributes: {}, effects: {}, yaw: 0, pitch: 0
  };
  const bot = { registry: data.registry, entity, jumpTicks: 0, jumpQueued: false,
    fireworkRocketDuration: 0, inventory: { slots: [] }, abilities: {},
    _bedrock: { physics: { isFlying: () => false } } };
  const state = new PlayerState(bot, { forward: true, back: false, left: false, right: false,
    jump: false, sprint: false, sneak: false });
  state.moveVector = { x: 0, z: 1 };
  const physics = Physics(data.registry, world);
  physics.simulatePlayer(state, world);
  assert.ok(state.pos.z > 0, 'forward input should move in the player facing direction');
  assert.ok(Number.isFinite(state.vel.y));
});

function movementWorld(unknown = false) {
  const data = fixture();
  const terrain = {
    dimension: 0,
    blockId(dimension, x, y, z) {
      if (unknown && x > 1) return null;
      return y < 0 ? 101 : 100;
    }
  };
  const client = { packets: [], queue(name, packet) { this.packets.push({ name, packet }); } };
  const timers = { setInterval(fn) { this.fn = fn; return { unref() {} }; }, clearInterval() {} };
  const controller = new BedrockMovementController(client, { terrain, collisionData: data, timers });
  const world = {
    closed: false, spawned: true, position: { x: 0, y: 1.62, z: 0 }, yaw: 0, pitch: 0,
    self: { runtimeId: 1 }, movementAuthority: 1, serverTick: 100n,
    serverTickObservedAt: Date.now(), dimension: 0, terrain,
    receivedChunks: new Map([['0:0', true]])
  };
  return { data, terrain, client, controller, world };
}

test('movement controller sends physics-backed forward input on the server tick stream', () => {
  const { controller, world } = movementWorld();
  assert.equal(controller.startPresence(world), true);
  assert.equal(controller.capability(world), 'ready');
  assert.equal(controller.runManualHold(world, { mode: 'forward', ticks: 8 }).status, 'accepted');
  const frame = controller.tick(101n);
  assert.ok(frame.input_data.includes('up'));
  assert.ok(frame.position.z > world.position.z);
  assert.ok(Number.isFinite(frame.delta.z));
  controller.releaseManual();
  const stopped = controller.tick(102n);
  assert.equal(stopped.input_data.includes('up'), false);
  assert.deepEqual(stopped.move_vector, { x: 0, z: 0 });
  controller.stop();
});

test('movement controller refuses to predict through an unknown terrain cell', () => {
  const { controller, world } = movementWorld(true);
  assert.equal(controller.startPresence(world), true);
  assert.equal(controller.runManualHold(world, { mode: 'forward', ticks: 8 }).status, 'accepted');
  const frame = controller.tick(101n);
  assert.equal(controller.snapshot().terrain.unknown, true);
  assert.deepEqual(frame.move_vector, { x: 0, z: 0 });
  assert.equal(controller.lastMovementResult.reason, 'terrain_not_fully_observed');
  controller.stop();
});

test('server correction replaces the predicted state and records reconciliation', () => {
  const { controller, world } = movementWorld();
  controller.startPresence(world);
  controller.runManualHold(world, { mode: 'forward', ticks: 8 });
  controller.tick(101n);
  controller.correct({ x: 0, y: 1.62, z: -0.2 }, 101n,
    { delta: { x: 0, y: 0, z: -0.1 }, on_ground: true });
  assert.equal(controller.corrections, 1);
  assert.equal(controller.lastCorrection.tick, '101');
  assert.ok(Math.abs(controller.state.pos.z - (-0.2)) < 1e-6);
  controller.stop();
});
