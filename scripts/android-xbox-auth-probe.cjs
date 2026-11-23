'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');

function runtimeLogger(file) {
  const phases = ['device_code', 'microsoft_approved', 'bedrock_credentials', 'verified', 'account_sent',
    'friends_loaded', 'discovery', 'connection', 'retrying', 'spawned', 'failed', 'disconnected', 'stopped'];
  const stages = ['microsoft_token', 'xbox_token', 'xbox_profile', 'account_save', 'bedrock_credentials',
    'friends', 'owner', 'discovery', 'connection', 'xbox_membership', 'world_transport',
    'nethernet_signalling', 'nethernet_peer', 'bedrock_login', 'bedrock_spawn', 'runtime'];
  const reasons = ['no_transport', 'transport', 'network', 'timeout', 'host_disconnect', 'nethernet_closed'];
  const steps = ['offer_sent', 'answer_received', 'peer_connected'];
  let previous;
  return snapshot => {
    if (!file || !phases.includes(snapshot.phase)) return;
    const event = { phase: snapshot.phase };
    if (stages.includes(snapshot.stage)) event.stage = snapshot.stage;
    if (reasons.includes(snapshot.reason)) event.reason = snapshot.reason;
    if (steps.includes(snapshot.step)) event.step = snapshot.step;
    if (Number.isInteger(snapshot.httpStatus) && snapshot.httpStatus >= 400 && snapshot.httpStatus <= 599) {
      event.httpStatus = snapshot.httpStatus;
    }
    if (typeof snapshot.xboxCode === 'string' && /^214\d{7}$/.test(snapshot.xboxCode)) {
      event.xboxCode = snapshot.xboxCode;
    }
    if (Number.isInteger(snapshot.nethernetCode) && snapshot.nethernetCode > 0 && snapshot.nethernetCode <= 255) {
      event.nethernetCode = snapshot.nethernetCode;
    }
    const key = JSON.stringify(event);
    if (key === previous) return;
    try {
      fs.appendFileSync(file, JSON.stringify({ ...event, at: Date.now() }) + '\n', { mode: 0o600 });
      previous = key;
    } catch {
      // The primary status and connection must continue if log storage fails.
    }
  };
}

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

function readHttpStatus(error) {
  const status = error?.response?.status ?? error?.status ?? error?.cause?.response?.status;
  if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
  // prismarine-auth 3.1.1 prefixes errors with the status and appends the raw body.
  // Extract only the status, never the message or body.
  const legacy = typeof error?.message === 'string' && /^([45]\d{2})\s/.exec(error.message);
  return legacy ? Number(legacy[1]) : undefined;
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
        const status = readHttpStatus(error);
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
  observe(auth.xbl, 'doSisuAuth', 'Xbox session token');
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
      options?.cacheName === 'sisu' ? microsoftCache : createMemoryCache(), {
      // Use the SDK's mobile Xbox exchange with the same Android title and account.
      flow: 'sisu',
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
      const status = readHttpStatus(error);
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

async function loadFriends(xbox, owner) {
  const ids = new Set();
  let truncated = false;
  for (let start = 0; start < 1000;) {
    const page = await xbox.request('GET',
      `https://social.xboxlive.com/users/me/people?startIndex=${start}&maxItems=100`,
      { contractVersion: '5' });
    if (!Array.isArray(page?.people)) throw new Error('Xbox people response missing');
    for (const person of page.people) {
      if ((person.isFriend ?? person.isFollowingCaller) === true && typeof person.xuid === 'string' && /^\d{1,20}$/.test(person.xuid)) {
        ids.add(person.xuid);
      }
    }
    start += page.people.length;
    if (!page.people.length || (Number.isInteger(page.totalCount) && start >= page.totalCount)) break;
    if (start >= 1000) truncated = true;
  }

  const friends = [];
  const xuids = [...ids];
  for (let offset = 0; offset < xuids.length; offset += 100) {
    const batch = xuids.slice(offset, offset + 100);
    const [profiles, presence] = await Promise.allSettled([
      xbox.request('POST', 'https://profile.xboxlive.com/users/batch/profile/settings',
        { contractVersion: '2', data: { userIds: batch, settings: ['Gamertag'] } }),
      xbox.request('POST', 'https://userpresence.xboxlive.com/users/batch',
        { contractVersion: '3', data: { users: batch, level: 'all' } })
    ]);
    const names = new Map((profiles.value?.profileUsers ?? []).map(profile =>
      [String(profile.id), profile.settings?.find(setting => setting.id === 'Gamertag')?.value]));
    const states = new Map((Array.isArray(presence.value) ? presence.value : []).map(record =>
      [String(record.xuid), record]));
    for (const xuid of batch) {
      const record = states.get(xuid);
      const rawState = typeof record?.state === 'string' ? record.state.toLowerCase() : '';
      const state = ['Online', 'Away', 'Offline'].find(state => state.toLowerCase() === rawState) ?? 'Unknown';
      const minecraft = (state === 'Online' || state === 'Away') &&
        (record.devices ?? []).some(device => (device.titles ?? []).some(title =>
          String(title.state).toLowerCase() === 'active' && title.name === 'Minecraft'));
      const gamertag = names.get(xuid);
      friends.push({ xuid, gamertag: typeof gamertag === 'string' ? gamertag.slice(0, 32) : '', state, minecraft });
    }
  }
  const order = { Online: 0, Away: 1, Unknown: 2, Offline: 3 };
  friends.sort((a, b) => Number(b.minecraft) - Number(a.minecraft) ||
    order[a.state] - order[b.state] || a.gamertag.localeCompare(b.gamertag));
  return { phase: 'friends_loaded', owner, friends, truncated };
}

// Android owns the descriptor and closes it after the embedded runtime exits.
function accountWriter(fd) {
  if (!Number.isInteger(fd) || fd < 0) return null;
  return account => fs.writeFileSync(fd, JSON.stringify(account) + '\n');
}

if (require.main === module) {
  process.env.HOME ??= __dirname;
  const sessionPath = path.join(__dirname, 'device-session.json');
  const session = fs.existsSync(sessionPath) ? JSON.parse(fs.readFileSync(sessionPath, 'utf8')) : {};
  const record = runtimeLogger(session.logFile);
  const status = path.join(__dirname, 'auth-status.json');
  const publish = snapshot => {
    fs.writeFileSync(status + '.tmp', JSON.stringify(snapshot), { mode: 0o600 });
    fs.renameSync(status + '.tmp', status);
    record(snapshot);
  };
  // This probe publishes only allowlisted fields. Upstream diagnostic output can include auth responses.
  require('debug').disable();
  console.info = console.warn = console.error = console.log = console.debug = () => {};
  const { Authflow, Titles } = require('prismarine-auth');
  const { XboxClient } = require('prismarine-xbox-services');
  const refreshToken = Number.isInteger(session.fd) ? fs.readFileSync(session.fd, 'utf8') : undefined;
  const saveAccount = accountWriter(session.saveFd);
  const friendsOwner = session.friendsOwner;
  const publishAuth = snapshot => {
    if (friendsOwner && snapshot.phase === 'device_code') throw new Error('Account needs sign-in');
    publish(snapshot);
  };
  const save = friendsOwner && saveAccount ? account => {
    if (account.xuid !== friendsOwner) throw new Error('Xbox account changed');
    return saveAccount(account);
  } : saveAccount;
  connectXboxAccount({ Authflow, Titles, XboxClient, refreshToken }, publishAuth, save)
    .then(async ({ auth, profile }) => {
      if (!friendsOwner) return publish({ phase: 'account_sent' });
      if (profile.xuid !== friendsOwner) throw new Error('Xbox account changed');
      try {
        publish(await loadFriends(new XboxClient(auth), profile.xuid));
      } catch (error) {
        publish({ phase: 'failed', stage: 'friends', httpStatus: readHttpStatus(error) });
        process.exitCode = 1;
      }
    })
    .catch(() => { process.exitCode = 1; });
}

module.exports = { accountWriter, connectXboxAccount, deviceCodeStatus, loadFriends, runtimeLogger, verifyXbox };
