'use strict';

const LEGACY_ACTION_IDS_1_26_60 = Object.freeze({
  take: 0, place: 1, swap: 2, drop: 3, destroy: 4, consume: 5,
  create: 6, lab_table_combine: 9, beacon_payment: 10, mine_block: 11,
  craft_recipe: 12, craft_recipe_auto: 13, craft_creative: 14, optional: 15,
  craft_grindstone_request: 16, craft_loom_request: 17, craft_reserved: 18,
  non_implemented: 19, results_deprecated: 20
});
const COUNTED = new Set(['take','place','drop','destroy','consume']);
const WITH_SOURCE = new Set(['take','place','swap','drop','destroy','consume']);
const WITH_DESTINATION = new Set(['take','place','swap']);
const EXECUTABLE_ACTION_TYPES = new Set([
  'take','place','swap','drop','destroy','consume','craft_recipe'
]);

class BedrockStackRequestError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BedrockStackRequestError';
    Object.assign(this, details);
  }
}

function normalizeSlotInfo(info, label) {
  if (!info || typeof info !== 'object' || Array.isArray(info))
    throw new TypeError(`stack request: missing ${label}`);
  const containerId = info.slot_type?.container_id ?? info.container_id;
  const slot = info.slot;
  const stackId = info.stack_id ?? info.stack_network_id ?? 0;
  if (typeof containerId !== 'string' || !/^[a-z0-9_]{1,64}$/.test(containerId))
    throw new TypeError(`stack request: invalid ${label} container`);
  if (!Number.isInteger(slot) || slot < 0 || slot > 255)
    throw new TypeError(`stack request: invalid ${label} slot`);
  if (!Number.isInteger(stackId) || stackId < -0x7fffffff || stackId > 0x7fffffff)
    throw new TypeError(`stack request: invalid ${label} stack id`);
  const result = { slot_type: { container_id: containerId }, slot, stack_id: stackId };
  const dynamic = info.slot_type?.dynamic_container_id;
  if (dynamic !== undefined) {
    if (!Number.isInteger(dynamic) || dynamic < 0 || dynamic > 255)
      throw new TypeError(`stack request: invalid ${label} dynamic container id`);
    result.slot_type.dynamic_container_id = dynamic;
  }
  return result;
}

function normalizeAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action) ||
      typeof action.type_id !== 'string' || !EXECUTABLE_ACTION_TYPES.has(action.type_id))
    throw new TypeError('stack request: unsupported action type');
  const legacy = LEGACY_ACTION_IDS_1_26_60[action.type_id];
  const out = { ...action, legacy_type_id: legacy };
  if (COUNTED.has(action.type_id) &&
      (!Number.isInteger(action.count) || action.count < 1 || action.count > 255))
    throw new TypeError(`stack request: invalid ${action.type_id} count`);
  if (WITH_SOURCE.has(action.type_id))
    out.source = normalizeSlotInfo(action.source, `${action.type_id} source`);
  if (WITH_DESTINATION.has(action.type_id))
    out.destination = normalizeSlotInfo(action.destination, `${action.type_id} destination`);
  if (action.type_id === 'drop') out.randomly = action.randomly === true;
  if (action.type_id === 'craft_recipe') {
    if (!Number.isInteger(action.recipe_network_id) || action.recipe_network_id < 0 ||
        action.recipe_network_id > 0x7fffffff)
      throw new TypeError('stack request: invalid recipe network id');
    const times = action.times_crafted ?? 1;
    if (!Number.isInteger(times) || times < 1 || times > 64)
      throw new TypeError('stack request: invalid craft count');
    out.times_crafted = times;
  }
  return out;
}

class BedrockStackRequestManager {
  constructor(client, options = {}) {
    if (!client || typeof client.on !== 'function' || typeof client.removeListener !== 'function' ||
        typeof client.queue !== 'function') throw new TypeError('Bedrock packet client is required');
    this.client = client;
    this.isEnabled = options.isEnabled ?? (() => false);
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.nextId = -1;
    this.pending = null;
    this.closed = false;
    this.lastOutcome = 'idle';
    this.onResponse = packet => this.receive(packet);
    this.onClose = () => this.close('connection_closed');
    client.on('item_stack_response', this.onResponse);
    client.on('close', this.onClose);
    client.on('end', this.onClose);
  }

  nextRequestId() {
    const id = this.nextId;
    this.nextId -= 2;
    if (this.nextId < -0x7ffffff0) this.nextId = -1;
    return id;
  }

  send(actions, options = {}) {
    if (this.closed) return Promise.reject(new BedrockStackRequestError('stack_request_manager_closed', { outcome: 'closed' }));
    if (this.isEnabled() !== true)
      return Promise.reject(new BedrockStackRequestError('server_authoritative_inventory_not_negotiated', { outcome: 'unsupported' }));
    if (this.pending) return Promise.reject(new BedrockStackRequestError('stack_request_busy', { outcome: 'busy' }));
    if (!Array.isArray(actions) || actions.length < 1 || actions.length > 64)
      return Promise.reject(new TypeError('stack request: actions must contain 1..64 entries'));
    if (typeof options.timeoutMs === 'number' &&
        (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 30000))
      return Promise.reject(new RangeError('stack request: invalid timeout'));
    let normalized;
    try { normalized = actions.map(normalizeAction); }
    catch (error) { return Promise.reject(error); }
    const request = {
      request_id: this.nextRequestId(),
      actions: normalized,
      custom_names: [],
      cause: -1
    };
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.request.request_id !== request.request_id) return;
        this.pending = null;
        this.lastOutcome = 'timeout';
        reject(new BedrockStackRequestError('item_stack_response_timeout', {
          outcome: 'timeout', requestId: request.request_id
        }));
      }, timeoutMs);
      timer.unref?.();
      this.pending = { request, resolve, reject, timer };
      try {
        this.client.queue('item_stack_request', { requests: [request] });
      } catch (error) {
        clearTimeout(timer);
        this.pending = null;
        this.lastOutcome = 'write_error';
        reject(new BedrockStackRequestError('item_stack_request_write_failed', {
          outcome: 'write_error', requestId: request.request_id, cause: error
        }));
      }
    });
  }

  receive(packet) {
    if (this.closed || !Array.isArray(packet?.responses)) return false;
    let matched = false;
    for (const response of packet.responses) {
      if (!this.pending || response?.request_id !== this.pending.request.request_id) continue;
      matched = true;
      const pending = this.pending;
      this.pending = null;
      clearTimeout(pending.timer);
      const ok = response.status === 'ok' || response.status === 0;
      this.lastOutcome = ok ? 'ok' : 'server_rejected';
      if (ok) pending.resolve(response);
      else pending.reject(new BedrockStackRequestError('item_stack_request_rejected_by_server', {
        outcome: 'server_rejected', status: response.status,
        requestId: response.request_id, response
      }));
    }
    return matched;
  }

  snapshot() {
    return {
      enabled: !this.closed && this.isEnabled() === true,
      pendingRequestId: this.pending?.request.request_id ?? null,
      pending: this.pending !== null,
      lastOutcome: this.lastOutcome,
      protocol: 'bedrock_1_26_60_item_stack_request'
    };
  }

  close(reason = 'manager_closed') {
    if (this.closed) return;
    this.closed = true;
    this.client.removeListener('item_stack_response', this.onResponse);
    this.client.removeListener('close', this.onClose);
    this.client.removeListener('end', this.onClose);
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      clearTimeout(pending.timer);
      this.lastOutcome = 'closed';
      pending.reject(new BedrockStackRequestError(reason, {
        outcome: 'closed', requestId: pending.request.request_id
      }));
    }
  }
}

module.exports = {
  BedrockStackRequestManager,
  BedrockStackRequestError,
  normalizeAction,
  normalizeSlotInfo,
  LEGACY_ACTION_IDS_1_26_60
};
