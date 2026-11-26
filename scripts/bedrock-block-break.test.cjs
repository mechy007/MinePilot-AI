'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BedrockBlockBreakExecutor } = require('../bedrock-block-break.cjs');
const { BedrockTerrainCache } = require('../bedrock-terrain-cache.cjs');
const { buildBedrockCollisionData } = require('../bedrock-collision-data.cjs');
const { BedrockMovementController } = require('../bedrock-movement-controller.cjs');

function collisionFixture() {
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

function fixture() {
  let now = 1000;
  let pulse = null;
  const packets = [];
  const client = { queue: (packet, value) => packets.push({ packet, value }) };
  const blockBreaker = new BedrockBlockBreakExecutor({ clock: () => now });
  const terrain = new BedrockTerrainCache();
  terrain.reset(0);
  terrain.setRegistry(new Map([
    [100, { name: 'minecraft:air', boundingBox: 'empty', fullCube: false }],
    [101, { name: 'minecraft:stone', boundingBox: 'block', fullCube: true }]
  ]));
  terrain.store(0, 0, 0, 3, new Uint32Array(4096).fill(101));
  terrain.store(0, 0, 0, 4, new Uint32Array(4096).fill(100));
  terrain.updateBlock({ position: { x: 9, y: 63, z: 8 }, layer: 0,
    block_runtime_id: 999 }, 0);

  const timers = {
    setInterval(fn) { pulse = fn; return 1; },
    clearInterval() {}
  };
  const movement = new BedrockMovementController(client, {
    clock: () => now, timers, terrain, collisionData: collisionFixture(),
    blockExecutor: blockBreaker
  });
  const world = {
    movement, terrain, dimension: 0, position: { x: 8.5, y: 65.62, z: 8.5 },
    yaw: 0, pitch: 0, movementAuthority: 1, serverTick: 100n,
    serverTickObservedAt: now, self: '123', spawned: true, closed: false,
    blockNetworkIdsAreHashes: true, receivedChunks: new Map([['0:0', now]]),
    lastServerPositionAt: now, gameplayWorld: () => ({ safetyHold: false })
  };
  return {
    client, packets, movement, terrain, blockBreaker, world,
    start() { return movement.startPresence(world); },
    pulse() { now += 50; if (pulse) pulse(); },
    now: () => now
  };
}

test('block-break requests require confirmation, reach and a verified solid target', () => {
  const f = fixture();
  assert.equal(f.start(), true);
  assert.equal(f.blockBreaker.start(f.world, { x: 8, y: 63, z: 8 }, false).reason,
    'confirmation_required');
  assert.equal(f.blockBreaker.start(f.world, { x: 20, y: 63, z: 8 }, true).reason,
    'target_out_of_reach');
  assert.equal(f.blockBreaker.start(f.world, { x: 9, y: 63, z: 8 }, true).reason,
    'target_not_verified_breakable');
  assert.equal(f.blockBreaker.start(f.world, { x: 8, y: 63, z: 8 }, true).status,
    'accepted');
  assert.equal(f.blockBreaker.start(f.world, { x: 8, y: 63, z: 8 }, true).reason,
    'block_action_busy');
  f.movement.stopPresence();
});

test('block break shares physics PlayerAuthInput ticks and waits for server block evidence', () => {
  const f = fixture();
  f.start();
  assert.equal(f.blockBreaker.start(f.world, { x: 8, y: 63, z: 8 }, true).status,
    'accepted');
  for (let i = 0; i < 30; i++) f.pulse();
  const actions = f.packets.filter(p => p.value.block_action);
  assert.equal(actions.length, 26);
  assert.equal(actions[0].value.block_action[0].action, 'start_break');
  assert.equal(actions.at(-1).value.block_action[0].action, 'stop_break');
  assert.ok(actions.every(p => p.value.input_data.includes(35)));
  assert.ok(f.packets.every((p, i) => i === 0 ||
    p.value.tick > f.packets[i - 1].value.tick));
  assert.equal(f.blockBreaker.snapshot().status, 'in_progress');
  assert.equal(f.blockBreaker.snapshot().serverChanged, false);
  f.blockBreaker.observedBlock({ position: { x: 8, y: 63, z: 8 },
    block_runtime_id: 101 }, 0);
  assert.equal(f.blockBreaker.snapshot().status, 'in_progress');
  f.blockBreaker.observedBlock({ position: { x: 8, y: 63, z: 8 },
    block_runtime_id: 100 }, 0);
  assert.equal(f.blockBreaker.snapshot().status, 'observed');
  assert.equal(f.blockBreaker.snapshot().serverChanged, true);
  assert.equal(f.blockBreaker.snapshot().reason,
    'server_block_changed_causality_unverified');
  f.movement.stopPresence();
});

test('block break aborts when movement authority is lost', () => {
  const f = fixture();
  f.start();
  f.blockBreaker.start(f.world, { x: 8, y: 63, z: 8 }, true);
  f.pulse();
  f.world.movementAuthority = 0;
  f.movement.stopPresence('authority_changed');
  assert.equal(f.blockBreaker.snapshot().active, false);
  assert.equal(f.blockBreaker.snapshot().status, 'stopped');
  assert.equal(f.movement.snapshot().presenceActive, false);
});
