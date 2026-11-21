import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { FriendWorldJoinRunner } from '../src/connection/friend-world-join-runner.js';
import type { BedrockClientFactory } from '../src/connection/prismarine-world-client.js';

test('friend-world runner selects owner, observes spawn, and disconnects', async () => {
  const emitter = new EventEmitter();
  let closed = 0;
  let ownerSelected = false;
  const factory: BedrockClientFactory = options => {
    assert.equal(options.offline, false);
    assert.equal(options.username, 'MyXboxAccount');
    ownerSelected = options.world.pickSession([{ sessionRef: { name: 'friend' }, customProperties: { ownerId: '12345' } }]).sessionRef.name === 'friend';
    return Object.assign(emitter, { close() { closed++; } });
  };
  const phases: string[] = [];
  const runner = new FriendWorldJoinRunner({ username: 'MyXboxAccount', friendOwnerXuid: '12345' },
    event => phases.push(event.phase), factory);
  const pending = runner.start();
  emitter.emit('spawn');
  await pending;
  assert.equal(ownerSelected, true);
  assert.equal(runner.state, 'spawned');
  runner.stop();
  assert.equal(closed, 1);
  assert.deepEqual(phases, ['authenticating', 'spawned', 'disconnected']);
});

test('friend-world runner fails closed on transport errors', async () => {
  const emitter = new EventEmitter();
  const factory: BedrockClientFactory = () => Object.assign(emitter, { close() {} });
  const runner = new FriendWorldJoinRunner({ username: 'MyXboxAccount', friendOwnerXuid: '12345' }, () => {}, factory);
  const pending = runner.start();
  emitter.emit('error', new Error('Xbox session not found'));
  await assert.rejects(pending, /Xbox session not found/);
  assert.equal(runner.state, 'failed');
  runner.stop();
});

test('friend-world runner validates friend owner XUID', () => {
  assert.throws(() => new FriendWorldJoinRunner({ username: 'user', friendOwnerXuid: 'bad' }, () => {}), /XUID/);
  assert.throws(() => new FriendWorldJoinRunner({ username: 'user', friendOwnerXuid: '18446744073709551616' }, () => {}), /XUID/);
});
