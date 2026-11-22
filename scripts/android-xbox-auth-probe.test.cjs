'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { connectXboxAccount, deviceCodeStatus, verifyXbox } = require('./android-xbox-auth-probe.cjs');

test('accepts official verification links and strips query parameters', () => {
  assert.deepEqual(deviceCodeStatus({
    verification_uri: 'https://www.microsoft.com/link?opaque=fixture',
    user_code: 'ABCD-1234'
  }), { phase: 'device_code', url: 'https://www.microsoft.com/link', code: 'ABCD-1234' });
  for (const verification_uri of ['https://microsoft.com.example.org/link', 'http://microsoft.com/link',
    'https://microsoft.com@evil.example/link', 'https://microsoft.com/other']) {
    assert.throws(() => deviceCodeStatus({ verification_uri, user_code: 'ABCD-1234' }));
  }
});

test('uses an Android title, keeps cache stores independent, and publishes no credentials', async () => {
  const statuses = [];
  class Authflow {
    async getXboxToken(relyingParty) {
      assert.equal(relyingParty, 'http://xboxlive.com');
    }
    constructor(username, cacheFactory, options, onCode) {
      assert.equal(options.authTitle, 'android-fixture');
      assert.equal(options.deviceType, 'Android');
      assert.notEqual(cacheFactory(), cacheFactory());
      onCode({ verification_uri: 'https://microsoft.com/link', user_code: 'ABCD-1234' });
    }
    async getMinecraftBedrockToken(key) {
      assert.ok(key.length > 100);
      const identity = Buffer.from(JSON.stringify({ extraData: { XUID: '2533274790000001' } })).toString('base64url');
      return { chain: ['fixture-account-token', 'header.' + identity + '.signature'], token: 'fixture-multiplayer-token' };
    }
  }
  class XboxClient {
    async getProfile(identity) {
      assert.equal(identity, 'me');
      return { xuid: '2533274790000001', gamertag: 'TestBot' };
    }
  }
  await verifyXbox({ Authflow, XboxClient, Titles: { MinecraftAndroid: 'android-fixture' } },
    status => statuses.push(status));
  assert.deepEqual(statuses.map(status => status.phase), ['device_code', 'bedrock_credentials', 'verified']);
  assert.deepEqual(statuses.at(-1), { phase: 'verified', xuid: '2533274790000001', gamertag: 'TestBot' });
  assert.equal(JSON.stringify(statuses).includes('fixture-account-token'), false);
  assert.equal(JSON.stringify(statuses).includes('fixture-multiplayer-token'), false);
});

test('outputs a safe failure when a Bedrock token cannot be minted', async () => {
  const statuses = [];
  class Authflow {
    async getXboxToken(relyingParty) {
      assert.equal(relyingParty, 'http://xboxlive.com');
    }
    async getMinecraftBedrockToken() { throw new Error('a token-bearing upstream error'); }
  }
  class XboxClient {
    async getProfile() { return { xuid: '42', gamertag: 'TestBot' }; }
  }
  await assert.rejects(verifyXbox({ Authflow, XboxClient, Titles: {} }, status => statuses.push(status)),
    /authentication probe failed/);
  assert.deepEqual(statuses.at(-1), { phase: 'failed', stage: 'bedrock_credentials' });
});

test('rejects a Bedrock identity that differs from the signed-in Xbox profile', async () => {
  const statuses = [];
  class Authflow {
    async getXboxToken(relyingParty) {
      assert.equal(relyingParty, 'http://xboxlive.com');
    }
    async getMinecraftBedrockToken() {
      const identity = Buffer.from(JSON.stringify({ extraData: { XUID: '84' } })).toString('base64url');
      return { chain: ['fixture', 'header.' + identity + '.signature'], token: 'fixture' };
    }
  }
  class XboxClient {
    async getProfile() { return { xuid: '42', gamertag: 'TestBot' }; }
  }
  await assert.rejects(verifyXbox({ Authflow, XboxClient, Titles: {} }, status => statuses.push(status)));
  assert.deepEqual(statuses.at(-1), { phase: 'failed', stage: 'bedrock_credentials' });
});

test('waits for interactive Xbox authorization before requesting the profile', async () => {
  let finishSignIn;
  let profileRequested = false;
  class Authflow {
    getXboxToken() {
      return new Promise(resolve => { finishSignIn = resolve; });
    }
  }
  class XboxClient {
    async getProfile() {
      profileRequested = true;
      return {};
    }
  }
  const result = verifyXbox({ Authflow, XboxClient, Titles: {} }, () => {});
  assert.equal(profileRequested, false);
  finishSignIn();
  await assert.rejects(result, /authentication probe failed/);
  assert.equal(profileRequested, true);
});

test('connects and hands off a verified Xbox account without requesting Bedrock', async () => {
  const events = [];
  const refreshToken = 'synthetic-refresh-token';
  class Authflow {
    constructor(username, cacheFactory) {
      this.cache = cacheFactory({ cacheName: 'live' });
    }
    async getMsaToken() {
      events.push('microsoft');
      await this.cache.setCached({ token: { refresh_token: refreshToken } });
    }
    async getXboxToken() { events.push('xbox'); }
  }
  class XboxClient {
    async getProfile() { return { xuid: '42', gamertag: 'TestBot' }; }
  }
  await connectXboxAccount({ Authflow, XboxClient, Titles: {} },
    status => events.push(status.phase),
    account => {
      assert.deepEqual(account, { refreshToken, xuid: '42', gamertag: 'TestBot' });
      events.push('save');
    });
  assert.deepEqual(events, ['microsoft', 'microsoft_approved', 'xbox', 'save']);
});
