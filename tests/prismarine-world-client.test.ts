import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { pickOwnerWorld, PrismarineWorldClient, type BedrockClientFactory } from '../src/connection/prismarine-world-client.js';

test('friend world selection requires exact unique owner XUID', () => {
  const mine = { sessionRef: { name: 'mine' }, customProperties: { ownerId: '123', protocol: 2225 } };
  const visited = { sessionRef: { name: 'visited' }, ownerXuid: '123', customProperties: { ownerId: '456' } };
  assert.equal(pickOwnerWorld([visited, mine], '123'), mine);
  assert.throws(() => pickOwnerWorld([visited], '123'), /not found/);
  assert.throws(() => pickOwnerWorld([{ ...mine, sessionRef: { name: '' } }], '123'), /not found/);
  assert.throws(() => pickOwnerWorld([mine, mine], '123'), /Ambiguous/);
});
test('friend world selection rejects an incompatible advertised protocol', () => {
  assert.throws(() => pickOwnerWorld([{
    sessionRef: { name: 'incompatible' },
    customProperties: { ownerId: '123', protocol: 2193 }
  }], '123'), /protocol mismatch.*2225/);
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
  assert.equal(options?.version, '1.26.60');
  const session = { sessionRef: { name: 'mine' }, customProperties: { ownerId: '123', protocol: '2225' } };
  assert.equal(options?.world.pickSession([session]), session);
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
