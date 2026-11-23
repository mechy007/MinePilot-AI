'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ExperimentalPlayerInput} = require('./bedrock-player-input.cjs');

test('diagnostic stop emits a neutral frame at the server position, never speculative movement', () => {
  let now = 1000;
  let pulse = null;
  const packets = [];
  const client = {queue: (name, value) => packets.push({name, value})};
  const movement = new ExperimentalPlayerInput(client, true, {
    clock: () => now,
    setInterval: callback => {pulse = callback; return 1;},
    clearInterval: () => {pulse = null;}
  });
  const world = {
    spawned: true, closed: false, self: '123', dimension: 0,
    position: {x: 0.5, y: 65, z: 0.5},
    yaw: 0, serverTick: 100n, movementAuthority: 1,
    receivedChunks: new Map([['0,0', 1000]]),
    lastServerPositionAt: now
  };

  assert.equal(movement.runDiagnostic(world, {mode:'forward', ticks: 3}).status, 'accepted');
  assert.equal(typeof pulse, 'function');
  pulse();
  assert.ok(packets[0].value.position.z > 0.5, 'movement frame predicts forward travel');

  // The actual host position differs from the predicted position.
  world.position = {x: 0.5, y: 65, z: 0.42};
  now += 50;
  world.lastServerPositionAt = now;
  movement.observeServerPosition(world.position, now);
  movement.stop('user_stopped');
  const neutral = packets.at(-1).value;
  assert.deepEqual(neutral.position, world.position);
  assert.deepEqual(neutral.input_data, []);
  assert.deepEqual(neutral.move_vector, {x: 0, z: 0});
  assert.ok(neutral.tick > packets[0].value.tick);
  assert.equal(movement.snapshot().movementVerified, false,
    'a server observation does not prove that the bot walked');
});

test('no extra speculative stop packet on closed world or already-stopped writer', () => {
  let pulse;
  const packets = [];
  const client = {queue: (name, value) => packets.push({name, value})};
  const movement = new ExperimentalPlayerInput(client, true, {
    clock: () => 1000,
    setInterval: callback => {pulse = callback; return 1;},
    clearInterval: () => {}
  });
  const world = {spawned:true, closed:false, self:'123',dimension:0,
    position:{x:0,y:65,z:0},serverTick:200n,movementAuthority:1,
    receivedChunks:new Map([['0,0',1000]]),lastServerPositionAt:1000};
  assert.equal(movement.runDiagnostic(world,{mode:'forward',ticks:2}).status,'accepted');
  pulse();
  world.closed = true;
  movement.stop('session_closed');
  assert.equal(packets.length,1);
  movement.stop();
  assert.equal(packets.length,1);
});
