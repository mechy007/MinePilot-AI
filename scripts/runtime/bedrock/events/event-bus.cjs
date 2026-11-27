'use strict';
const EVENT_NAME = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
class RuntimeEventBus {
  constructor(options = {}) {
    this.maxListeners = Number.isInteger(options.maxListeners) ? Math.max(1, Math.min(256, options.maxListeners)) : 64;
    this.maxEvents = Number.isInteger(options.maxEvents) ? Math.max(1, Math.min(4096, options.maxEvents)) : 512;
    this.clock = options.clock ?? Date.now; this.listeners = new Map(); this.history = [];
    this.nextId = 1; this.closed = false; this.errors = 0; this.emitted = 0; this.dropped = 0;
  }
  subscribe(name, callback, options = {}) {
    if (this.closed) return { status: 'rejected', reason: 'event_bus_closed', unsubscribe: () => false };
    if (typeof name !== 'string' || !EVENT_NAME.test(name) || typeof callback !== 'function')
      return { status: 'rejected', reason: 'invalid_subscription', unsubscribe: () => false };
    const list = this.listeners.get(name) ?? [];
    if (list.length >= this.maxListeners) return { status: 'rejected', reason: 'listener_limit_reached', unsubscribe: () => false };
    const priority = Number.isFinite(options.priority) ? Math.max(-100, Math.min(100, Math.trunc(options.priority))) : 0;
    const entry = { id: this.nextId++, callback, priority, once: options.once === true };
    list.push(entry); list.sort((a, b) => b.priority - a.priority || a.id - b.id); this.listeners.set(name, list);
    let active = true;
    return { status: 'subscribed', id: entry.id, unsubscribe: () => {
      if (!active) return false; active = false; return this.unsubscribe(entry.id);
    }};
  }
  unsubscribe(id) {
    if (!Number.isSafeInteger(id) || id <= 0) return false;
    let removed = false;
    for (const [name, list] of this.listeners) {
      const next = list.filter(entry => { if (entry.id !== id) return true; removed = true; return false; });
      if (next.length) this.listeners.set(name, next); else this.listeners.delete(name);
    }
    return removed;
  }
  emit(name, payload) {
    if (this.closed || typeof name !== 'string' || !EVENT_NAME.test(name)) {
      this.dropped++; return { delivered: 0, errors: 0, dropped: true };
    }
    const at = this.clock(); const event = Object.freeze({ name, at, payload });
    this.emitted++; this.history.push({ name, at });
    if (this.history.length > this.maxEvents) this.history.splice(0, this.history.length - this.maxEvents);
    const snapshot = [...(this.listeners.get(name) ?? [])]; let delivered = 0; let errors = 0;
    for (const entry of snapshot) {
      if (!(this.listeners.get(name) ?? []).some(current => current.id === entry.id)) continue;
      try { entry.callback(event); delivered++; } catch { errors++; this.errors++; }
      if (entry.once) this.unsubscribe(entry.id);
    }
    return { delivered, errors, dropped: false };
  }
  snapshot() {
    return { closed: this.closed, eventTypes: this.listeners.size,
      listeners: [...this.listeners.values()].reduce((sum, list) => sum + list.length, 0),
      emitted: this.emitted, errors: this.errors, dropped: this.dropped,
      recent: this.history.slice(-32).map(value => ({ ...value })) };
  }
  close() { if (!this.closed) { this.closed = true; this.listeners.clear(); this.history.length = 0; } }
}
module.exports = { RuntimeEventBus, EVENT_NAME };
