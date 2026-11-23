import assert from 'node:assert/strict';
import test from 'node:test';
import { LayerTwoPlanner } from '../src/gameplay/layer-two.js';

const start = { x: 0, y: 64, z: 0 };
const world = { position: start, dimension: 0, spawned: true, chunks: 3, safetyHold: false };

test('follow requires one exact, fresh, visible name and never selects nearest implicitly', () => {
  let now = 1000;
  const planner = new LayerTwoPlanner(() => now);
  planner.observePlayer('42', 'Friend One', { x: 15, y: 64, z: 0 }, 0);
  planner.observePlayer('43', 'Stranger', { x: 2, y: 64, z: 0 }, 0);
  assert.equal(planner.follow('NearMe', world).reason, 'player_not_visible');
  assert.equal(planner.follow('friend one', world).reason, 'follow_plan_only');
  const route = planner.preview(world);
  assert.equal(route.goal, 'follow');
  assert.equal(route.targetName, 'Friend One');
  assert.equal(route.status, 'route_unverified');
  assert.equal(route.heading, 270);
  assert.equal(route.nextPoint?.x, 1);
  assert.equal(route.executed, false);
  now += 8001;
  assert.equal(planner.preview(world).reason, 'player_position_stale');
  assert.equal(planner.knownPlayers(world).length, 0);
});

test('follow stops at configured distance but never sends gameplay packets', () => {
  const planner = new LayerTwoPlanner(() => 1000);
  planner.observePlayer('42', 'Friend', { x: 2.5, y: 64, z: 0 }, 0);
  assert.equal(planner.follow('friend', world).status, 'accepted');
  assert.equal(planner.preview(world).status, 'at_target');
  assert.equal(planner.preview(world).executed, false);
  planner.movePlayer('42', { x: 6, y: 64, z: 0 });
  assert.equal(planner.preview(world).reason, 'direct_route_needs_collision_data');
  planner.removePlayer('42');
  assert.equal(planner.preview(world).status, 'waiting_for_target');
});

test('disallows ambiguous names, invalid names, wrong dimensions, and stale actor observations', () => {
  const planner = new LayerTwoPlanner(() => 1000);
  assert.equal(planner.observePlayer('untrusted', 'Friend', start, 0), false);
  assert.equal(planner.observePlayer('41', '<script>', start, 0), false);
  assert.equal(planner.observePlayer('41', 'Friend', start, 1), true);
  assert.equal(planner.follow('Friend', world).reason, 'player_not_visible');
  assert.equal(planner.observePlayer('42', 'Friend', start, 0), true);
  assert.equal(planner.observePlayer('43', 'friend', start, 0), true);
  assert.equal(planner.follow('Friend', world).reason, 'ambiguous_player');
  assert.equal(planner.follow('!invalid!', world).reason, 'invalid_player_name');
});

test('return home uses the user-marked position only in the same dimension', () => {
  const planner = new LayerTwoPlanner(() => 1000);
  assert.equal(planner.returnHome(world).reason, 'home_unavailable');
  assert.equal(planner.markHome(world).status, 'ok');
  const away = { ...world, position: { x: 6, y: 64, z: 0 } };
  assert.equal(planner.returnHome(away).status, 'accepted');
  assert.equal(planner.preview(away).status, 'route_unverified');
  assert.equal(planner.preview(away).heading, 90);
  assert.equal(planner.preview(world).status, 'at_target');
  const nether = { ...away, dimension: 1 };
  assert.equal(planner.preview(nether).reason, 'different_dimension');
  assert.equal(planner.returnHome(nether).reason, 'home_unavailable');
});

test('safety, missing blocks, steep gradients and stale positions block route execution', () => {
  const planner = new LayerTwoPlanner(() => 1000);
  planner.observePlayer('42', 'Friend', { x: 10, y: 68, z: 0 }, 0);
  planner.follow('Friend', world);
  assert.equal(planner.preview(world).reason, 'vertical_path_requires_voxel_data');
  assert.equal(planner.preview({ ...world, safetyHold: true }).status, 'paused_by_safety');
  assert.equal(planner.preview({ ...world, chunks: 0 }).status, 'awaiting_world');
  assert.equal(planner.preview({ ...world, position: null }).status, 'awaiting_world');
});

test('equipment observation is bot-only, bounded and does not modify inventory', () => {
  const planner = new LayerTwoPlanner(() => 1000);
  assert.equal(planner.observeEquipment(10, 1), false);
  assert.equal(planner.observeEquipment(2, 'not-an-item'), false);
  assert.equal(planner.observeEquipment(2, 42), true);
  assert.deepEqual(planner.snapshot(world).equipment,
    { known: true, slot: 2, itemId: '42', seenAt: 1000 });
  planner.reset();
  assert.equal(planner.snapshot(world).equipment.known, false);
});

test('explicit stay and cancel affect planning, not simulated movement', () => {
  const planner = new LayerTwoPlanner(() => 1000);
  assert.equal(planner.stay().status, 'accepted');
  assert.equal(planner.preview(world).status, 'stay');
  planner.cancel();
  assert.equal(planner.preview(world).status, 'idle');
  planner.markHome(world);
  planner.dimensionChanged();
  assert.equal(planner.snapshot(world).homeKnown, false);
});
