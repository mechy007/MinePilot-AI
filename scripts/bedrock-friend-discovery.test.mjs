import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { PrismarineWorldClient } from '../dist/src/connection/prismarine-world-client.js';

const require = createRequire(import.meta.url);
const { createClient } = require('bedrock-protocol');
const { XboxClient } = require('prismarine-xbox-services');
const botXuid = '2533274790000001';
const friendXuid = '2533274790000002';

for (const protocol of [2225, 2193]) {
  test(`real SDK friend activity selection with advertised protocol ${protocol}`, async context => {
    const requests = [];
    const join = context.mock.method(XboxClient.prototype, 'joinSession', async () => {
      throw new Error('Stopped at Xbox membership boundary');
    });
    context.mock.method(globalThis, 'fetch', async (input, options) => {
      const url = new URL(input);
      requests.push(url.pathname);
      if (url.hostname === 'profile.xboxlive.com') {
        assert.match(url.pathname, /^\/users\/me\//);
        return Response.json({ profileUsers: [{ id: botXuid }] });
      }
      assert.equal(url.hostname, 'sessiondirectory.xboxlive.com');
      assert.equal(url.pathname, '/handles/query');
      assert.equal(JSON.parse(options.body).owners.people.monikerXuid, botXuid);
      return Response.json({ results: [
        {
          id: 'visited-handle',
          sessionRef: { name: 'visited-world' },
          ownerXuid: friendXuid,
          customProperties: { ownerId: botXuid, protocol: 2225 }
        },
        {
          id: 'friend-handle',
          id: 'other-handle',
          sessionRef: { name: 'friend-world' },
          ownerXuid: friendXuid,
          customProperties: { ownerId: friendXuid, protocol }
        },
        {
          sessionRef: { name: 'friend-world' },
          ownerXuid: '2533274790000003',
          customProperties: { ownerId: friendXuid, protocol }
        }
      ] });
    });
    const world = new PrismarineWorldClient('Test bot', friendXuid, options => createClient({
      ...options,
      authflow: { async getXboxToken() { return { userHash: 'fixture', XSTSToken: 'fixture' }; } }
    }));
    await assert.rejects(world.connectAndSpawn(new AbortController().signal),
      protocol === 2225 ? /Stopped at Xbox membership boundary/ : /protocol mismatch/);
    assert.deepEqual(requests, ['/users/me/settings', '/handles/query']);
    assert.deepEqual(join.mock.calls.map(call => call.arguments[0]), protocol === 2225 ? ['friend-world'] : []);
    assert.equal(world.activeClient, null);
  });
}
