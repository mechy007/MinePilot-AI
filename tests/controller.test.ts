import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionController, type ConnectionDriver } from '../src/connection/controller.js';
const successDriver: ConnectionDriver = {
  async authenticate() {}, async discoverOwnerSession() {}, async connect() {}, async waitForSpawn() {}
};
test('controller reaches ready without real network', async () => {
  const c = new ConnectionController(successDriver);
  await c.start();
  assert.equal(c.state, 'ready');
  assert.equal(c.diagnostics.snapshot().at(-1)?.code, 'STATE_READY');
  c.stop();
  assert.equal(c.state, 'disconnected');
});
test('controller records failure and exhausts bounded retries', async () => {
  const c = new ConnectionController({ ...successDriver, async authenticate() { throw new Error('token=secret'); } },
    { initialDelayMs: 1, maxDelayMs: 1, maxAttempts: 1 });
  await c.start();
  assert.equal(c.state, 'failed');
  assert.ok(c.diagnostics.snapshot().some(e => e.code === 'RETRIES_EXHAUSTED'));
  assert.ok(!JSON.stringify(c.diagnostics.snapshot()).includes('secret'));
});
test('stop during pending auth never advances connection state', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const c = new ConnectionController({ ...successDriver, async authenticate() { await gate; } });
  const pending = c.start();
  c.stop();
  release();
  await pending;
  assert.equal(c.state, 'disconnected');
});

test('controller can restart cleanly after stopping a ready connection', async () => {
  const c = new ConnectionController(successDriver);
  await c.start();
  c.stop();
  await c.start();
  assert.equal(c.state, 'ready');
  c.stop();
});
test('controller rejects overlapping start calls', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const c = new ConnectionController({ ...successDriver, async authenticate() { await gate; } });
  const first = c.start();
  await assert.rejects(c.start(), /already running/);
  c.stop();
  release();
  await first;
});

for (const stage of ['discoverOwnerSession', 'connect', 'waitForSpawn'] as const) {
  test(`stop during pending ${stage} does not advance or retry`, async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reached = new Promise<void>(resolve => { entered = resolve; });
    let laterCalls = 0;
    const driver: ConnectionDriver = {
      async authenticate() { if (stage !== 'discoverOwnerSession') return; },
      async discoverOwnerSession() { if (stage === 'discoverOwnerSession') { entered(); await gate; } else return; },
      async connect() { if (stage === 'connect') { entered(); await gate; } else return; },
      async waitForSpawn() { if (stage === 'waitForSpawn') { entered(); await gate; } else laterCalls++; }
    };
    const c = new ConnectionController(driver);
    const pending = c.start();
    await reached;
    c.stop();
    release();
    await pending;
    assert.equal(c.state, 'disconnected');
    assert.equal(laterCalls, 0);
    assert.ok(!c.diagnostics.snapshot().some(e => e.code === 'CONNECTION_ATTEMPT_FAILED'));
  });
}
