import test from 'node:test';
import assert from 'node:assert/strict';
import { NavigationAuthority } from '../src/gameplay/navigation-authority.js';

const one = { x: 1, y: 64, z: 1 };
const two = { x: 2, y: 64, z: 2 };

test('higher priority safety requests preempt normal work', () => {
  const nav = new NavigationAuthority();
  nav.request('task', one, { ttlMs: 500 }, 1000);
  nav.request('survival', two, { ttlMs: 500 }, 1000);
  assert.deepEqual(nav.selected(1100), { kind: 'move', owner: 'survival', request: {
    source: 'survival', target: two, mode: 'walk', hold: false, expiresAt: 1500
  } });
});
test('requests expire and cannot keep moving the player forever', () => {
  const nav = new NavigationAuthority();
  nav.request('follow', one, { ttlMs: 200 }, 1000);
  assert.equal(nav.selected(1199).kind, 'move');
  assert.equal(nav.selected(1200).kind, 'stop');
});
test('manual control preempts follow then resumes after release', () => {
  const nav = new NavigationAuthority();
  nav.request('follow', one, { ttlMs: 500 }, 1000);
  nav.request('manual', two, { ttlMs: 200 }, 1000);
  assert.equal(nav.selected(1100).kind, 'move');
  const manualDecision = nav.selected(1100);
  assert.equal(manualDecision.kind === 'move' ? manualDecision.owner : '', 'manual');
  nav.release('manual');
  const followDecision = nav.selected(1100);
  assert.equal(followDecision.kind === 'move' ? followDecision.owner : '', 'follow');
});
test('emergency stop is sticky until explicitly cleared', () => {
  const nav = new NavigationAuthority();
  nav.request('manual', one, { ttlMs: 1000 }, 1000);
  nav.emergencyStop('user pressed stop');
  assert.equal(nav.selected(1100).kind, 'stop');
  nav.clearEmergency();
  assert.equal(nav.selected(1100).kind, 'move');
});
test('invalid coordinates and lifetimes are rejected', () => {
  const nav = new NavigationAuthority();
  assert.throws(() => nav.request('manual', { x: NaN, y: 64, z: 0 }), /Invalid target/);
  assert.throws(() => nav.request('manual', one, { ttlMs: -1 }), /lifetime/);
  assert.throws(() => nav.request('follow', undefined), /requires a target/);
});
test('hold requests win arbitration without moving toward coordinates', () => {
  const nav = new NavigationAuthority();
  nav.request('combat', undefined, { hold: true, reason: 'aiming', ttlMs: 400 }, 1000);
  const decision = nav.selected(1100);
  assert.equal(decision.kind, 'move');
  if (decision.kind === 'move') {
    assert.equal(decision.request.hold, true);
    assert.equal(decision.request.target, undefined);
  }
});
