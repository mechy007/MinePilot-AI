'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.basename(__dirname) === 'scripts' ? path.resolve(__dirname, '..') : __dirname;
const { Vec3 } = require(path.join(root, 'vendor/bedboo-physics/lib/vec3'));
const { Physics, PlayerState } = require(path.join(root, 'vendor/bedboo-physics/lib/physics'));
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
  assert.equal(data.profilesByStateId.get(0).name, 'air');
  assert.equal(data.profilesByStateId.get(1).name, 'stone');
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
  assert.ok(state.pos.z < 0, 'forward input should move in the player facing direction');
  assert.ok(Number.isFinite(state.vel.y));
});

function movementWorld() {
  const data = fixture();
  const terrain = {
    dimension: 0,
    registry: new Map([[100, { name: 'minecraft:air' }], [101, { name: 'minecraft:stone' }]]),
    unknown: false,
    blockId(dimension, x, y, z) {
      if (this.unknown) return null;
      return y < 0 ? 101 : 100;
    }
  };
  const client = { packets: [], queue(name, packet) { this.packets.push({ name, packet }); } };
  const timers = { setInterval(fn) { this.fn = fn; return { unref() {} }; }, clearInterval() {} };
  const controller = new BedrockMovementController(client, { terrain, collisionData: data, timers });
  const world = {
    closed: false, spawned: true, position: { x: 0, y: 1.62, z: 0 }, yaw: 0, pitch: 0,
    self: { runtimeId: 1 }, movementAuthority: 1, serverTick: 100n,
    serverTickObservedAt: Date.now(), dimension: 0, blockNetworkIdsAreHashes: true, terrain,
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
  controller.stop('session_closed');
});

test('analog diagonal movement combines jump and sprint flags and supports sneak', () => {
  const { controller, world } = movementWorld();
  controller.startPresence(world);
  assert.equal(controller.runManualHold(world, {
    mode: 'vector', vector: { x: 0.6, y: 0.8 }, jump: true, sprint: true, ticks: 8
  }).status, 'accepted');
  const moving = controller.tick(101n);
  assert.ok(moving.input_data.includes('up'));
  assert.ok(moving.input_data.includes('right'));
  assert.ok(moving.input_data.includes('jumping'));
  assert.ok(moving.input_data.includes('sprinting'));
  assert.ok(Math.hypot(moving.move_vector.x, moving.move_vector.z) <= 1.001);
  assert.equal(controller.runManualHold(world, {
    mode: 'sneak', vector: { x: 0, y: 0 }, sneak: true, ticks: 8
  }).status, 'accepted');
  const sneaking = controller.tick(102n);
  assert.ok(sneaking.input_data.includes('sneaking'));
  controller.stop('session_closed');
});

test('movement controller applies horizontal and vertical camera look controls', () => {
  const { controller, world } = movementWorld();
  controller.startPresence(world);
  assert.equal(controller.runManualHold(world, { mode: 'turn_left', ticks: 8 }).status, 'accepted');
  const turned = controller.tick(101n);
  assert.ok(turned.yaw > 0);
  assert.equal(controller.runManualHold(world, { mode: 'look_up', ticks: 8 }).status, 'accepted');
  const looked = controller.tick(102n);
  assert.ok(looked.pitch < 0);
  controller.stop('session_closed');
});

test('movement controller refuses to predict through an unknown terrain cell', () => {
  const { controller, world, terrain } = movementWorld();
  assert.equal(controller.startPresence(world), true);
  assert.equal(controller.runManualHold(world, { mode: 'forward', ticks: 8 }).status, 'accepted');
  terrain.unknown = true;
  const frame = controller.tick(101n);
  assert.equal(controller.snapshot().terrain.unknown, true);
  assert.deepEqual(frame.move_vector, { x: 0, z: 0 });
  assert.equal(controller.lastMovementResult.reason, 'terrain_not_fully_observed');
  const missing = controller.snapshot().terrain.unknownCells[0];
  assert.equal(missing.reason, 'block_not_observed');
  assert.ok(Number.isInteger(missing.x) && Number.isInteger(missing.y) && Number.isInteger(missing.z));
  terrain.unknown = false;
  assert.equal(controller.runManualHold(world, { mode: 'forward', ticks: 8 }).status, 'accepted');
  controller.stop('session_closed');
});


test('movement controller supports numeric runtime-state palettes as well as hashed IDs', () => {
  const data = fixture();
  const terrain = {
    dimension: 0,
    registry: new Map([[0, { name: 'minecraft:air' }], [1, { name: 'minecraft:stone' }]]),
    blockId(dimension, x, y) { return y < 0 ? 1 : 0; }
  };
  const client = { packets: [], queue(name, packet) { this.packets.push({ name, packet }); } };
  const timers = { setInterval() { return { unref() {} }; }, clearInterval() {} };
  const controller = new BedrockMovementController(client, { terrain, collisionData: data, timers });
  const world = {
    closed: false, spawned: true, position: { x: 0, y: 1.62, z: 0 }, yaw: 0, pitch: 0,
    self: { runtimeId: 1 }, movementAuthority: 1, serverTick: 100n,
    serverTickObservedAt: Date.now(), dimension: 0, blockNetworkIdsAreHashes: false,
    terrain, receivedChunks: new Map([['0:0', true]])
  };
  assert.equal(controller.startPresence(world), true);
  assert.equal(controller.physicsWorld.hashedIds, false);
  assert.equal(controller.runManualHold(world, { mode: 'forward', ticks: 8 }).status, 'accepted');
  const frame = controller.tick(101n);
  assert.ok(frame.position.z > world.position.z);
  controller.stop('session_closed');
});


test('manual prediction continues past seven seconds without a positive correction packet', () => {
  const { controller, world } = movementWorld();
  assert.equal(controller.startPresence(world), true);
  controller.unconfirmedMovement = true;
  controller.nonNeutralFrames = 20;
  controller.lastNonNeutralAt = Date.now() - 8001;
  assert.equal(controller.capability(world), 'ready');
  assert.equal(controller.runManualHold(world, { mode: 'forward', ticks: 8 }).status, 'accepted');
  const frame = controller.tick(101n);
  assert.ok(frame.input_data.includes('up'));
  assert.equal(controller.manualHoldActive, true);
  assert.equal(controller.lastMovementResult.status, 'awaiting_server_correction');
  controller.stop('session_closed');
});

test('terrain preflight follows the predicted position instead of a stale server spawn position', () => {
  const { controller, world, terrain } = movementWorld();
  const queried = [];
  const original = terrain.blockId.bind(terrain);
  terrain.blockId = (dimension, x, y, z) => {
    queried.push({ x, y, z });
    return original(dimension, x, y, z);
  };
  assert.equal(controller.startPresence(world), true);
  queried.length = 0;
  controller.state.pos.x = 48.25;
  assert.equal(controller.preflightTerrain(world), true);
  assert.ok(queried.length > 0);
  assert.ok(queried.every(cell => cell.x >= 47 && cell.x <= 49));
  controller.stop('session_closed');
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
  controller.stop('session_closed');
});
