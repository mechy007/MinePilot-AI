'use strict';

const { randomUUID } = require('node:crypto');

const MPSD_BASE = 'https://sessiondirectory.xboxlive.com';
const RTA_CONNECTIONS_URI = 'https://sessiondirectory.xboxlive.com/connections/';
const NONCE_TIMEOUT_MS = 10_000;
const UINT64_MAX = 18446744073709551615n;

function idString(value) {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'bigint' && value >= 0n) return value.toString();
  return null;
}

function validNetherNetId(value) {
  const text = idString(value);
  if (!text || !/^\d+$/.test(text)) return null;
  try {
    const id = BigInt(text);
    return id > 0n && id <= UINT64_MAX ? id.toString() : null;
  } catch {
    return null;
  }
}

function validPmsgId(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value : null;
}

/**
 * ConnectionType 7 uses JSON-RPC addressed to the host's player messaging ID.
 * ConnectionType 3 uses legacy signalling addressed to its NetherNet ID.
 * A type-7 entry without PmsgId falls back to the legacy route used by PrismarineJS.
 */
function selectFriendWorldConnection(customProperties) {
  const entries = Array.isArray(customProperties?.SupportedConnections)
    ? customProperties.SupportedConnections : [];
  const jsonRpc = entries.find(entry => Number(entry?.ConnectionType) === 7 && validPmsgId(entry?.PmsgId));
  if (jsonRpc) {
    return {
      connectionType: 7,
      peerId: validPmsgId(jsonRpc.PmsgId),
      signallingProtocol: 'jsonrpc'
    };
  }
  const legacy = entries.find(entry => [3, 7].includes(Number(entry?.ConnectionType)) &&
    validNetherNetId(entry?.NetherNetId));
  if (!legacy) return null;
  return {
    connectionType: Number(legacy.ConnectionType),
    peerId: validNetherNetId(legacy.NetherNetId),
    signallingProtocol: 'legacy'
  };
}

function readSessionNonce(session, xuid) {
  const nonce = session?.properties?.custom?.nonces?.[xuid];
  return typeof nonce === 'string' && nonce.length > 0 ? nonce : null;
}

async function waitForWorldNonce({ xbox, sessionName, xuid, session, subscription, rta, signal, timeoutMs = NONCE_TIMEOUT_MS }) {
  const initial = readSessionNonce(session, xuid);
  if (initial) return initial;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000) {
    throw new RangeError('Invalid friend-world nonce timeout');
  }
  if (signal?.aborted) throw signal.reason ?? new Error('Friend-world join cancelled');

  return new Promise((resolve, reject) => {
    let settled = false;
    let reading = false;
    const finish = (nonce, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription.removeListener?.('data', refresh);
      rta.removeListener?.('resync', refresh);
      signal?.removeEventListener('abort', aborted);
      if (error) reject(error);
      else resolve(nonce);
    };
    const aborted = () => finish(null, signal.reason ?? new Error('Friend-world join cancelled'));
    const refresh = async () => {
      if (settled || reading) return;
      reading = true;
      try {
        const latest = await xbox.getSession(sessionName, { signal, timeout: 5_000 });
        const nonce = readSessionNonce(latest, xuid);
        if (nonce) finish(nonce);
      } catch (error) {
        if (signal?.aborted) finish(null, signal.reason ?? error);
      } finally {
        reading = false;
      }
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    subscription.on('data', refresh);
    rta.on('resync', refresh);
    signal?.addEventListener('abort', aborted, { once: true });
    refresh();
  });
}

function createJoinBody(xuid, connectionId, subscriptionId) {
  return {
    members: {
      me: {
        constants: { system: { xuid, initialize: true } },
        properties: {
          system: {
            active: true,
            connection: connectionId,
            subscription: { id: subscriptionId, changeTypes: ['everything'] }
          }
        }
      }
    }
  };
}

function createManagedSession({ xbox, world, rta, subscription, controller, initialSession, connectionId, publish }) {
  let closed = false;
  let closing = null;
  let activeConnectionId = connectionId;
  const updateConnection = async data => {
    const next = typeof data?.ConnectionId === 'string' ? data.ConnectionId : null;
    if (!next || next === activeConnectionId || closed) return;
    activeConnectionId = next;
    try {
      await xbox.updateSession(world.sessionRef.name, {
        members: { me: { properties: { system: { active: true, connection: next } } } }
      }, { timeout: 10_000 });
    } catch {
      publish?.({ phase: 'connection', stage: 'world_transport', reason: 'network' });
    }
  };
  subscription.on('ready', updateConnection);

  return {
    current: initialSession,
    async get(options) {
      const latest = await xbox.getSession(world.sessionRef.name, options);
      this.current = latest;
      return latest;
    },
    close() {
      if (closing) return closing;
      closed = true;
      controller.abort(new Error('Friend-world session closing'));
      closing = (async () => {
        try { if (typeof subscription.close === 'function') await subscription.close(); } catch {}
        try { if (typeof rta.close === 'function') await rta.close(); } catch {}
        try {
          await xbox.updateSession(world.sessionRef.name, { members: { me: null } }, { timeout: 5_000 });
        } catch {
          // The RTA socket is already closed; the server expires membership if leave cannot be sent.
        }
      })();
      return closing;
    }
  };
}

/**
 * Joins a selected Xbox activity handle using the MPSD handle endpoint and a live RTA
 * ConnectionId. Keeps the RTA subscription alive for the Bedrock session lifetime.
 */
async function joinFriendWorld({
  xbox,
  profile,
  ownerXuid,
  XboxRTASocket,
  pickOwnerWorld,
  publish = () => {},
  onStage = () => {},
  signal,
  nonceTimeoutMs = NONCE_TIMEOUT_MS
}) {
  if (!xbox || typeof xbox.getActivityHandles !== 'function' || typeof xbox.request !== 'function') {
    throw new TypeError('Xbox session client is unavailable');
  }
  if (typeof XboxRTASocket !== 'function') throw new TypeError('Xbox RTA client is unavailable');
  if (typeof pickOwnerWorld !== 'function') throw new TypeError('Friend-world selector is unavailable');
  if (!profile?.xuid || !ownerXuid) throw new TypeError('Xbox profile and friend owner are required');
  if (signal?.aborted) throw signal.reason ?? new Error('Friend-world join cancelled');

  const controller = new AbortController();
  const joinSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let rta = null;
  let subscription = null;
  let session = null;
  let world = null;
  let joined = false;
  const setStage = stage => {
    onStage(stage);
    publish({ phase: 'connection', stage });
  };

  try {
    setStage('discovery');
    const handles = await xbox.getActivityHandles(profile.xuid, { signal: joinSignal });
    world = pickOwnerWorld(handles, ownerXuid);
    if (!world?.id || !world?.sessionRef?.name) throw new Error('Selected friend world has no joinable activity handle');
    const route = selectFriendWorldConnection(world.customProperties);
    if (!route) throw new Error('Friend world has no supported NetherNet signalling route');

    setStage('world_transport');
    rta = new XboxRTASocket(xbox);
    await rta.connect({ signal: joinSignal, timeout: 15_000 });
    subscription = await rta.subscribe(RTA_CONNECTIONS_URI, { signal: joinSignal });
    const connectionId = subscription.initialData?.ConnectionId;
    if (typeof connectionId !== 'string' || !connectionId) {
      throw new Error('Xbox RTA did not provide a membership ConnectionId');
    }

    setStage('xbox_membership');
    const subscriptionId = randomUUID().toUpperCase();
    const handleUrl = `${MPSD_BASE}/handles/${encodeURIComponent(world.id)}/session`;
    const sessionDocument = await xbox.request('PUT', handleUrl, {
      contractVersion: '107',
      signal: joinSignal,
      timeout: 15_000,
      data: createJoinBody(profile.xuid, connectionId, subscriptionId)
    });
    joined = true;

    try {
      await xbox.setActivity(world.sessionRef.name, { signal: joinSignal });
    } catch {
      // Activity publication is useful for presence but does not determine join membership.
    }

    setStage('world_nonce');
    const nonce = await waitForWorldNonce({
      xbox,
      sessionName: world.sessionRef.name,
      xuid: profile.xuid,
      session: sessionDocument,
      subscription,
      rta,
      signal: joinSignal,
      timeoutMs: nonceTimeoutMs
    });

    session = createManagedSession({
      xbox, world, rta, subscription, controller, initialSession: sessionDocument,
      connectionId, publish
    });
    return {
      world,
      session,
      nonce,
      peerId: route.peerId,
      signallingProtocol: route.signallingProtocol,
      connectionType: route.connectionType,
      sessionAbort: controller
    };
  } catch (error) {
    controller.abort(error);
    if (subscription) {
      try { if (typeof subscription.close === 'function') await subscription.close(); } catch {}
    }
    if (rta) {
      try { if (typeof rta.close === 'function') await rta.close(); } catch {}
    }
    if (joined && world?.sessionRef?.name) {
      try {
        await xbox.updateSession(world.sessionRef.name, { members: { me: null } }, { timeout: 5_000 });
      } catch {
        // Best-effort leave after a failed join.
      }
    }
    throw error;
  }
}

module.exports = {
  RTA_CONNECTIONS_URI,
  createJoinBody,
  joinFriendWorld,
  readSessionNonce,
  selectFriendWorldConnection,
  waitForWorldNonce
};
