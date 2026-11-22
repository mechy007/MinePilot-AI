'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');

function createMemoryCache() {
  let values = {};
  return {
    async reset() { values = {}; },
    async getCached() { return values; },
    async setCached(next) { values = next; },
    async setCachedPartial(partial) { values = { ...values, ...partial }; }
  };
}

function deviceCodeStatus({ verification_uri, user_code }) {
  const url = new URL(verification_uri);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['microsoft.com', 'www.microsoft.com'].includes(url.hostname) ||
      !['/link', '/devicelogin'].includes(url.pathname.toLowerCase()) ||
      typeof user_code !== 'string' || !/^[A-Z0-9-]{4,16}$/i.test(user_code)) {
    throw new Error('Unexpected Microsoft device-code response');
  }
  return { phase: 'device_code', url: url.origin + url.pathname, code: user_code };
}

async function verifyXbox({ Authflow, Titles, XboxClient, browserSession }, publish) {
  let stage = 'microsoft_xbox';
  try {
    let auth;
    if (browserSession) {
      if (!browserSession.access || !browserSession.clientId) throw new Error('Sign in again');
      auth = new Authflow('minepilot-bot', createMemoryCache, {
        flow: 'msal', authTitle: browserSession.clientId, deviceType: 'Android'
      });
      // Android owns interactive sign-in and refresh. SDK exchanges use this account only.
      auth.getMsaToken = async () => browserSession.access;
    } else {
      auth = new Authflow('minepilot-android-probe', createMemoryCache, {
        flow: 'live', authTitle: Titles.MinecraftAndroid, deviceType: 'Android'
      }, code => publish(deviceCodeStatus(code)));
    }
    // Wait for interactive sign-in before the Xbox profile request starts its deadline.
    await auth.getXboxToken('http://xboxlive.com');
    const xbox = new XboxClient(auth);
    const profile = await xbox.getProfile('me');
    if (typeof profile.xuid !== 'string' || !/^\d{1,20}$/.test(profile.xuid) || typeof profile.gamertag !== 'string' || !profile.gamertag) {
      throw new Error('Xbox profile identity missing');
    }

    stage = 'bedrock_credentials';
    publish({ phase: 'bedrock_credentials' });
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
    const key = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const { chain, token } = await auth.getMinecraftBedrockToken(key, { version: '1.26.60' });
    if (!Array.isArray(chain) || chain.length < 2 || typeof token !== 'string' || !token) {
      throw new Error('Bedrock credentials missing');
    }
    const identity = JSON.parse(Buffer.from(chain[1].split('.')[1], 'base64url').toString('utf8'));
    if (identity.extraData?.XUID !== profile.xuid) throw new Error('Bedrock and Xbox identities differ');
    publish({ phase: 'verified', gamertag: profile.gamertag, xuid: profile.xuid });
    return { auth, profile };
  } catch {
    publish({ phase: 'failed', stage });
    throw new Error('Xbox authentication probe failed');
  }
}

if (require.main === module) {
  process.env.HOME ??= __dirname;
  const status = path.join(__dirname, 'auth-status.json');
  const publish = snapshot => {
    fs.writeFileSync(status + '.tmp', JSON.stringify(snapshot), { mode: 0o600 });
    fs.renameSync(status + '.tmp', status);
  };
  // This probe publishes only allowlisted fields. Upstream diagnostic output can include auth responses.
  require('debug').disable();
  console.info = console.warn = console.error = console.log = () => {};
  const { Authflow, Titles } = require('prismarine-auth');
  const { XboxClient } = require('prismarine-xbox-services');
  verifyXbox({ Authflow, Titles, XboxClient, browserSession }, publish).catch(() => { process.exitCode = 1; });
}

module.exports = { deviceCodeStatus, verifyXbox };
