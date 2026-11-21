import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { pickOwnerWorld, PrismarineWorldClient, type BedrockClientFactory } from '../src/connection/prismarine-world-client.js';

test('friend world selection requires exact unique owner XUID', () => {
  const mine = { hostXuid: '123', customProperties: { worldName: 'My World' } };
  assert.equal(pickOwnerWorld([{ hostXuid: '456' }, mine], '123'), mine);
  assert.throws(() => pickOwnerWorld([{ hostXuid: '456' }], '123'), /not found/);
  assert.throws(() => pickOwnerWorld([mine, mine], '123'), /Ambiguous/);
});
test('actual client path requests Xbox auth and waits for spawn', async () => {
  const emitter = new EventEmitter();
  let closed = false;
  let options: Parameters<BedrockClientFactory>[0] | undefined;
  const factory: BedrockClientFactory = opts => {
    options = opts;
    return Object.assign(emitter, { close() { closed = true; } });
  };
  const client = new PrismarineWorldClient('MinePilotBot', '123', factory);
  const pending = client.connectAndSpawn(new AbortController().signal);
  assert.equal(options?.offline, false);
  assert.equal(options?.world.pickSession([{hostXuid:'123'}]).hostXuid, '123');
  emitter.emit('spawn');
  await pending;
  assert.equal(closed, false);
  client.disconnect();
  assert.equal(closed, true);
});
test('abort closes transport and rejects pending spawn', async () => {
  const emitter = new EventEmitter();
  let closed = 0;
  const factory: BedrockClientFactory = () => Object.assign(emitter, { close() { closed++; } });
  const client = new PrismarineWorldClient('MinePilotBot', '123', factory);
  const aborter = new AbortController();
  const pending = client.connectAndSpawn(aborter.signal);
  aborter.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(closed, 1);
});

test('friend-world connection preserves transport error and closes failed session', async () => {
  const emitter = new EventEmitter();
  let closed = 0;
  const factory: BedrockClientFactory = () => Object.assign(emitter, { close() { closed++; } });
  const client = new PrismarineWorldClient('MinePilotBot', '123', factory);
  const pending = client.connectAndSpawn(new AbortController().signal);
  emitter.emit('error', new Error('Friend world not joinable'));
  await assert.rejects(pending, /Friend world not joinable/);
  assert.match(client.connectionError?.message ?? '', /Friend world not joinable/);
  assert.equal(closed, 1);
});
test('invalid join timeout rejects before transport creation', async () => {
  let created = false;
  const factory: BedrockClientFactory = () => { created = true; throw new Error('Unexpected'); };
  const client = new PrismarineWorldClient('MinePilotBot', '123', factory);
  await assert.rejects(client.connectAndSpawn(new AbortController().signal, 0), /Invalid join timeout/);
  assert.equal(created, false);
});
