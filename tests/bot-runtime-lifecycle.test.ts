import test from 'node:test';
import assert from 'node:assert/strict';
import { BotRuntime } from '../src/core/bot-runtime.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

test('concurrent connect is rejected and late completion is cancelled', async () => {
  const gate = deferred<void>();
  let disconnects = 0;
  let connects = 0;
  const runtime = new BotRuntime({
    async connect() { connects++; await gate.promise; },
    async disconnect() { disconnects++; },
    async observe() { throw new Error('should not observe'); },
    async moveToward() { throw new Error('should not move'); }
  });
  const pending = runtime.connect();
  await assert.rejects(runtime.connect(), /Already connecting/);
  await runtime.disconnect();
  gate.resolve();
  await assert.rejects(pending, /Connection cancelled/);
  assert.equal(connects, 1);
  assert.equal(disconnects, 1);
  assert.equal(runtime.isConnected, false);
});

test('observation from disconnected session cannot command replacement session', async () => {
  const gate = deferred<{ position: {x:number;y:number;z:number}; health:number; hunger:number }>();
  const moves: unknown[] = [];
  const runtime = new BotRuntime({
    async connect() {},
    async disconnect() {},
    async observe() { return gate.promise; },
    async moveToward(p) { moves.push(p); }
  });
  await runtime.connect();
  runtime.setTarget({ x: 3, y: 64, z: 1 });
  const staleStep = runtime.step();
  await runtime.disconnect();
  await runtime.connect();
  gate.resolve({ position: { x: 0, y: 64, z: 0 }, health: 20, hunger: 20 });
  await assert.rejects(staleStep, /Runtime stopped/);
  assert.deepEqual(moves, []);
  await runtime.disconnect();
});

test('movement result retains submitted target when target changes during await', async () => {
  const gate = deferred<void>();
  const submitted: unknown[] = [];
  const runtime = new BotRuntime({
    async connect() {},
    async disconnect() {},
    async observe() { return { position: { x: 0, y: 64, z: 0 }, health: 20, hunger: 20 }; },
    async moveToward(p) { submitted.push(p); await gate.promise; }
  });
  await runtime.connect();
  const first = { x: 1, y: 64, z: 1 };
  runtime.setTarget(first);
  const step = runtime.step();
  await Promise.resolve();
  runtime.setTarget({ x: 9, y: 64, z: 9 });
  gate.resolve();
  const result = await step;
  assert.deepEqual(submitted, [first]);
  assert.deepEqual(result.target, first);
  await runtime.disconnect();
});
