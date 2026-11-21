import test from 'node:test';
import assert from 'node:assert/strict';
import { BotRuntime, type BotObservation } from '../src/core/bot-runtime.js';

const position = { x: 0, y: 64, z: 0 };
function fixture(observation: BotObservation = { position, health: 20, hunger: 20 }) {
  const moves: Array<{x:number;y:number;z:number}> = [];
  let connected = false;
  const runtime = new BotRuntime({
    async connect() { connected = true; },
    async disconnect() { connected = false; },
    async observe() { assert.equal(connected, true); return observation; },
    async moveToward(target) { moves.push(target); }
  });
  return { runtime, moves };
}
test('ordinary target moves through adapter', async () => {
  const { runtime, moves } = fixture();
  await runtime.connect();
  runtime.setTarget({ x: 10, y: 64, z: 0 });
  assert.equal((await runtime.step()).mode, 'moving');
  assert.equal(moves.length, 1);
  await runtime.disconnect();
});
test('drowning suppresses ordinary movement without safe target', async () => {
  const { runtime, moves } = fixture({ position, health: 20, hunger: 20, drowning: true });
  await runtime.connect();
  runtime.setTarget({ x: 10, y: 64, z: 0 });
  assert.equal((await runtime.step()).mode, 'survival');
  assert.equal(moves.length, 0);
  await runtime.disconnect();
});
test('survival target overrides ordinary movement', async () => {
  const safePosition = { x: 0, y: 70, z: 0 };
  const { runtime, moves } = fixture({ position, health: 20, hunger: 20, drowning: true, safePosition });
  await runtime.connect();
  runtime.setTarget({ x: 10, y: 64, z: 0 });
  assert.equal((await runtime.step()).mode, 'survival');
  assert.deepEqual(moves, [safePosition]);
  await runtime.disconnect();
});
test('cannot run without connection', async () => {
  const { runtime } = fixture();
  await assert.rejects(runtime.step(), /Not connected/);
});
