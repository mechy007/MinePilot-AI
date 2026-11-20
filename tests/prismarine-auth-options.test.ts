import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PrismarineWorldClient, type BedrockClientFactory } from '../src/connection/prismarine-world-client.js';

test('device code callback and auth cache path reach the real client options', async () => {
  const events = new EventEmitter();
  let opts: Parameters<BedrockClientFactory>[0] | undefined;
  const factory: BedrockClientFactory = options => {
    opts = options;
    return Object.assign(events, { close() {} });
  };
  const codes: string[] = [];
  const bot = new PrismarineWorldClient('MinePilotBot', '123', factory, {
    profilesFolder: '/secure/app-private/tokens',
    onMsaCode: code => { if (code.user_code) codes.push(code.user_code); }
  });
  const pending = bot.connectAndSpawn(new AbortController().signal);
  assert.equal(opts?.profilesFolder, '/secure/app-private/tokens');
  opts?.onMsaCode?.({ user_code: 'TEST-CODE' });
  assert.deepEqual(codes, ['TEST-CODE']);
  events.emit('spawn');
  await pending;
  bot.disconnect();
});
