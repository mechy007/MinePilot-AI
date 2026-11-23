import test from 'node:test';
import assert from 'node:assert/strict';
import { LayerOneController } from '../src/gameplay/layer-one.js';

const position = { x: 10, y: 64, z: 10 };
const world = { position, chunks: 2, spawned: true };

test('inspect needs an authenticated spawned position, never fabricates world', () => {
  const controller = new LayerOneController(() => 1000);
  assert.equal(controller.inspect({ position: null, chunks: 0, spawned: true }).reason, 'world_not_ready');
  assert.equal(controller.snapshot().task?.state, 'waiting_for_world');
  assert.equal(controller.inspect(world).reason, 'inspection_complete');
  assert.equal(controller.snapshot().task?.state, 'completed');
});

test('wait acquires movement authority and requires stop before a probe', () => {
  const controller = new LayerOneController(() => 1000);
  assert.equal(controller.wait().status, 'accepted');
  assert.equal(controller.snapshot().movementOwner, 'manual');
  assert.equal(controller.canProbe(world).reason, 'wait_mode_active');
  controller.stop();
  assert.equal(controller.snapshot().movementOwner, null);
  assert.equal(controller.beginProbe(world).status, 'accepted');
  assert.equal(controller.snapshot().movementOwner, 'manual');
});

test('critical health preempts active tasks and blocks probe movement', () => {
  let now = 1000;
  const controller = new LayerOneController(() => now);
  controller.beginProbe(world);
  controller.probeQueued();
  assert.equal(controller.onVitals({ health: 4, hunger: 2 }), true);
  assert.equal(controller.snapshot().movementOwner, 'survival');
  assert.equal(controller.snapshot().task?.state, 'paused_by_safety');
  assert.equal(controller.canProbe(world).reason, 'critical_health');
  now += 100;
  assert.equal(controller.onVitals({ health: 12 }), false);
  assert.equal(controller.snapshot().movementOwner, 'manual');
  controller.stop();
  assert.equal(controller.snapshot().movementOwner, null);
});

test('only a server-observed position change verifies a movement probe', () => {
  let now = 1000;
  const controller = new LayerOneController(() => now);
  assert.equal(controller.beginProbe(world).status, 'accepted');
  controller.probeQueued();
  assert.equal(controller.snapshot().task?.state, 'awaiting_server_verification');
  controller.onServerPosition({ x: 10.05, y: 64, z: 10 });
  assert.equal(controller.snapshot().task?.state, 'awaiting_server_verification');
  controller.onServerPosition({ x: 10.25, y: 64, z: 10 });
  assert.equal(controller.snapshot().task?.state, 'completed');
  assert.equal(controller.snapshot().task?.reason, 'server_position_changed');
  assert.equal(controller.snapshot().movementOwner, null);
  controller.beginProbe(world);
  controller.probeQueued();
  now = 9000;
  assert.equal(controller.snapshot().task?.state, 'unverified');
  assert.equal(controller.snapshot().task?.reason, 'no_server_position_confirmation');
});

test('inventory observer accepts only bounded server-reported player stacks', () => {
  const controller = new LayerOneController(() => 5000);
  assert.equal(controller.onInventory({ window_id: 3, input: [{ network_id: 1, count: 64 }] }), false);
  assert.equal(controller.snapshot().inventory.known, false);
  assert.equal(controller.onInventory({ window_id: 0, input: [
    { network_id: 2, count: 1 }, { network_id: 0, count: 0 }, { network_id: 4, count: 64 }
  ] }), true);
  assert.deepEqual(controller.snapshot().inventory, {
    known: true, slotCount: 3, occupiedSlots: 2, observedAt: 5000
  });
  assert.equal(controller.onInventory({ window_id: 0, input: Array.from({ length: 200 }, () => ({})) }), false);
  assert.equal(controller.snapshot().inventory.occupiedSlots, 2);
});

test('reset removes stale world knowledge, task and movement reservations', () => {
  const controller = new LayerOneController(() => 1000);
  controller.onInventory({ window_id: 0, slots: [{ network_id: 1, count: 1 }] });
  controller.wait();
  controller.reset();
  assert.equal(controller.snapshot().movementOwner, null);
  assert.equal(controller.snapshot().task, null);
  assert.equal(controller.snapshot().inventory.known, false);
});

test('follow, mine and building remain unimplemented rather than reporting progress', () => {
  const controller = new LayerOneController(() => 1000);
  assert.equal(controller.canProbe({ position: null, chunks: 0, spawned: false }).allowed, false);
  assert.equal(controller.inspect({ position: null, chunks: 0, spawned: false }).status, 'rejected');
});
