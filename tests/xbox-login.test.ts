import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  XboxLoginService, LoginError, classifyLoginError,
  type AuthflowFactory, type LoginEvent, type RawDeviceCode
} from '../src/auth/xbox-login.js';
import { PrismarineWorldClient, type BedrockClientFactory } from '../src/connection/prismarine-world-client.js';
import { FriendWorldJoinRunner } from '../src/connection/friend-world-join-runner.js';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

async function makeDir(): Promise<string> {
  return path.join(await mkdtemp(path.join(tmpdir(), 'minepilot-login-')), 'xbox-auth');
}

function service(factory: AuthflowFactory, cacheDir: string) {
  const events: LoginEvent[] = [];
  const login = new XboxLoginService({ username: 'bot', cacheDir, authflowFactory: factory }, e => events.push(e));
  return { login, events };
}

test('saved tokens: signs in silently without showing a code', async () => {
  const dir = await makeDir();
  const flow = { getXboxToken: async () => ({ userXUID: '1' }) };
  const { login, events } = service(() => flow, dir);
  const result = await login.signIn();
  assert.equal(result, flow);
  assert.equal(login.authflow, flow);
  assert.equal(login.state, 'signed_in');
  assert.deepEqual(events.map(e => e.phase), ['signing_in', 'signed_in']);
  assert.ok(events.every(e => e.code === undefined));
});

test('device code is reported, then sign-in completes', async () => {
  const dir = await makeDir();
  const factory: AuthflowFactory = (_u, _d, onCode) => ({
    getXboxToken: async () => {
      onCode({ user_code: 'ABCD1234', verification_uri: 'https://www.microsoft.com/link' });
      await tick();
      return {};
    }
  });
  const { login, events } = service(factory, dir);
  await login.signIn();
  assert.deepEqual(events.map(e => e.phase), ['signing_in', 'awaiting_code', 'signed_in']);
  assert.equal(events[1].code?.userCode, 'ABCD1234');
  assert.equal(events[1].code?.verificationUri, 'https://www.microsoft.com/link');
});

test('non-interactive sign-in fails with interactive_required instead of showing a code', async () => {
  const dir = await makeDir();
  const factory: AuthflowFactory = (_u, _d, onCode) => ({
    getXboxToken: () => new Promise(() => { onCode({ user_code: 'X', verification_uri: 'https://example.test' }); })
  });
  const { login, events } = service(factory, dir);
  await assert.rejects(login.signIn({ interactive: false }), (e: unknown) => e instanceof LoginError && e.kind === 'interactive_required');
  assert.equal(login.state, 'signed_out');
  assert.ok(events.every(e => e.phase !== 'awaiting_code'));
  assert.equal(login.authflow, null);
});

test('Xbox errors become friendly, token-free messages', () => {
  const cases: Array<[string, string]> = [
    ['XSTS failed XErr 2148916233', 'no_xbox_profile'],
    ['XErr 2148916235', 'region_blocked'],
    ['XErr 2148916236', 'adult_verification'],
    ['XErr 2148916237', 'adult_verification'],
    ['XErr 2148916238', 'child_account'],
    ['device code expired', 'code_expired'],
    ['getaddrinfo ENOTFOUND login.live.com', 'network'],
    ['something odd with secret-token-abc', 'unknown']
  ];
  for (const [text, kind] of cases) {
    const error = classifyLoginError(new Error(text));
    assert.equal(error.kind, kind, text);
    assert.ok(!error.message.includes('secret-token-abc'));
    assert.ok(!error.message.includes('login.live.com'));
  }
});

test('a failed login reports failed with the error kind', async () => {
  const dir = await makeDir();
  const { login, events } = service(() => ({ getXboxToken: async () => { throw new Error('XErr 2148916238'); } }), dir);
  await assert.rejects(login.signIn(), (e: unknown) => e instanceof LoginError && e.kind === 'child_account');
  assert.equal(login.state, 'failed');
  assert.equal(events.at(-1)?.errorKind, 'child_account');
});

test('concurrent signIn calls share one login attempt', async () => {
  const dir = await makeDir();
  let created = 0;
  const factory: AuthflowFactory = () => {
    created++;
    return { getXboxToken: async () => { await tick(); return {}; } };
  };
  const { login } = service(factory, dir);
  const [a, b] = await Promise.all([login.signIn(), login.signIn()]);
  assert.equal(a, b);
  assert.equal(created, 1);
});

test('aborting cancels sign-in and leaves the service signed out', async () => {
  const dir = await makeDir();
  const factory: AuthflowFactory = (_u, _d, onCode: (c: RawDeviceCode) => void) => ({
    getXboxToken: () => new Promise(() => { onCode({ user_code: 'ABCD', verification_uri: 'https://example.test' }); })
  });
  const { login, events } = service(factory, dir);
  const controller = new AbortController();
  const pending = login.signIn({ signal: controller.signal });
  await tick();
  controller.abort();
  await assert.rejects(pending, (e: unknown) => e instanceof LoginError && e.kind === 'cancelled');
  assert.equal(login.state, 'signed_out');
  assert.equal(events.at(-1)?.phase, 'signed_out');
});

test('signOut deletes saved tokens and clears the session', async () => {
  const dir = await makeDir();
  const flow = { getXboxToken: async () => ({}) };
  const { login } = service(() => flow, dir);
  await login.signIn();
  await writeFile(path.join(dir, 'token-cache.json'), '{}');
  await login.signOut();
  assert.equal(login.state, 'signed_out');
  assert.equal(login.authflow, null);
  await assert.rejects(access(dir));
});

test('unsafe cache folders and empty usernames are rejected', () => {
  const factory: AuthflowFactory = () => ({ getXboxToken: async () => ({}) });
  assert.throws(() => new XboxLoginService({ username: 'bot', cacheDir: '/', authflowFactory: factory }));
  assert.throws(() => new XboxLoginService({ username: 'bot', cacheDir: '/data', authflowFactory: factory }));
  assert.throws(() => new XboxLoginService({ username: 'bot', cacheDir: 'relative/dir', authflowFactory: factory }));
  assert.throws(() => new XboxLoginService({ username: '  ', cacheDir: '/data/app/auth', authflowFactory: factory }));
});

test('the signed-in authflow reaches bedrock-protocol options', async () => {
  const flow = { getXboxToken: async () => ({}) };
  const events = new EventEmitter();
  let seen: unknown;
  const factory: BedrockClientFactory = options => {
    seen = options.authflow;
    return Object.assign(events, { close() {} });
  };
  const bot = new PrismarineWorldClient('bot', '123', factory, { authflow: flow });
  const pending = bot.connectAndSpawn(new AbortController().signal);
  assert.equal(seen, flow);
  events.emit('spawn');
  await pending;
  bot.disconnect();
});

test('join runner passes the authflow through and omits it when absent', async () => {
  const flow = { getXboxToken: async () => ({}) };
  const seen: unknown[] = [];
  const make = (authflow?: unknown) => {
    const emitter = new EventEmitter();
    const factory: BedrockClientFactory = options => {
      seen.push('authflow' in options ? options.authflow : 'absent');
      queueMicrotask(() => emitter.emit('spawn'));
      return Object.assign(emitter, { close() {} });
    };
    return new FriendWorldJoinRunner({ username: 'bot', friendOwnerXuid: '123', ...(authflow ? { authflow } : {}) }, () => {}, factory);
  };
  const withFlow = make(flow);
  await withFlow.start();
  withFlow.stop();
  const without = make();
  await without.start();
  without.stop();
  assert.deepEqual(seen, [flow, 'absent']);
});
