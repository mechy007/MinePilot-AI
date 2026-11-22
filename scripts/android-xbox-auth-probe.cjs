'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');

function createMemoryCache(initial = {}) {
  let values = initial;
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

// Observe the dependency's individual steps, including errors it retries internally.
function observeXboxExchange(auth, failures) {
  function observe(target, method, label) {
    const original = target?.[method];
    if (typeof original !== 'function') return;
    target[method] = async function (...args) {
      try {
        return await original.apply(this, args);
      } catch (error) {
        const type = ['TypeError', 'RangeError', 'SyntaxError', 'URIError', 'AbortError']
          .includes(error?.name) ? error.name : 'Error';
        const status = error?.response?.status ?? error?.status;
        const detail = Number.isInteger(status) && status >= 400 && status <= 599
          ? `HTTP ${status}` : type;
        if (failures.length < 4) failures.push(`${label}: ${detail}`);
        throw error;
      }
    };
  }
  observe(auth, 'getMsaToken', 'Microsoft token refresh');
  observe(auth.xbl, 'getUserToken', 'Xbox user token');
  observe(auth.xbl, 'getDeviceToken', 'Xbox device token');
  observe(auth.xbl, 'getTitleToken', 'Xbox title token');
  observe(auth.xbl, 'getXSTSToken', 'Xbox session token');
}

async function connectXboxAccount({ Authflow, Titles, XboxClient, refreshToken }, publish, saveAccount = null) {
  let stage = 'microsoft_token';
  const failures = [];
  try {
    const initialCache = refreshToken
      ? { token: { access_token: '', refresh_token: refreshToken, expires_in: 0, obtainedOn: 0 } }
      : {};
    const microsoftCache = createMemoryCache(initialCache);
    const auth = new Authflow('minepilot-bot', options =>
      options?.cacheName === 'live' ? microsoftCache : createMemoryCache(), {
      flow: 'live',
      authTitle: Titles.MinecraftAndroid,
      deviceType: 'Android'
    }, code => publish(deviceCodeStatus(code)));
    if (saveAccount) {
      await auth.getMsaToken();
      publish({ phase: 'microsoft_approved' });
      stage = 'xbox_token';
      observeXboxExchange(auth, failures);
    }
    // Wait for interactive sign-in before the Xbox profile request starts its deadline.
    await auth.getXboxToken('http://xboxlive.com');
    stage = 'xbox_profile';
    const xbox = new XboxClient(auth);
    const profile = await xbox.getProfile('me');
    if (typeof profile.xuid !== 'string' || !/^\d{1,20}$/.test(profile.xuid) || typeof profile.gamertag !== 'string' || !profile.gamertag) {
      throw new Error('Xbox profile identity missing');
    }

    stage = 'account_save';
    // Save the approved Xbox account before Bedrock-specific checks. A Bedrock
    // entitlement or credential failure must not discard a valid Xbox login.
    if (saveAccount) {
      const cached = await microsoftCache.getCached();
      const savedRefreshToken = cached.token?.refresh_token ?? refreshToken;
      if (typeof savedRefreshToken !== 'string' || savedRefreshToken.length < 20) {
        throw new Error('Microsoft refresh token missing');
      }
      await saveAccount({ refreshToken: savedRefreshToken, gamertag: profile.gamertag, xuid: profile.xuid });
    }

    return { auth, profile };
  } catch (error) {
    const result = { phase: 'failed', stage };
    if (stage === 'xbox_token') {
      if (failures.length) result.exchangeFailures = failures;
      // Publish only a numeric Xbox status. Error messages and bodies can contain secrets.
      const code = String(error?.errorCode ?? error?.data?.XErr ?? '');
      const fallback = typeof error?.message === 'string'
        ? /\bXErr:\s*(214\d{7})\b/.exec(error.message)?.[1] : undefined;
      const xboxCode = /^214\d{7}$/.test(code) ? code : fallback;
      if (xboxCode) result.xboxCode = xboxCode;
      const status = error?.response?.status ?? error?.status ?? error?.cause?.response?.status;
      if (Number.isInteger(status) && status >= 400 && status <= 599) result.httpStatus = status;
      const transport = error?.cause?.code ?? error?.code;
      if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
        'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'CERT_HAS_EXPIRED',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(transport)) {
        result.transport = transport;
      }
    }
    publish(result);
    throw new Error('Xbox authentication probe failed');
  }
}

async function verifyXbox(dependencies, publish, saveAccount = null) {
  const { auth, profile } = await connectXboxAccount(dependencies, publish, saveAccount);
  try {
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
    publish({ phase: 'failed', stage: 'bedrock_credentials' });
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
  console.info = console.warn = console.error = console.log = console.debug = () => {};
  const { Authflow, Titles } = require('prismarine-auth');
  const { XboxClient } = require('prismarine-xbox-services');
  const sessionPath = path.join(__dirname, 'device-session.json');
  const session = fs.existsSync(sessionPath) ? JSON.parse(fs.readFileSync(sessionPath, 'utf8')) : {};
  const refreshToken = Number.isInteger(session.fd) ? fs.readFileSync(session.fd, 'utf8') : undefined;
  const saveAccount = Number.isInteger(session.saveFd)
    ? account => fs.writeSync(session.saveFd, JSON.stringify(account) + "\n")
    : null;
  connectXboxAccount({ Authflow, Titles, XboxClient, refreshToken }, publish, saveAccount)
    .then(() => publish({ phase: 'account_sent' }))
    .catch(() => { process.exitCode = 1; });
}

module.exports = { connectXboxAccount, deviceCodeStatus, verifyXbox };
