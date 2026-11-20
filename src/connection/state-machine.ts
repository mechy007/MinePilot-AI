export type ConnectionState = 'disconnected' | 'authenticating' | 'discovering' | 'connecting' | 'spawned' | 'ready' | 'failed';
export type ConnectionEvent = 'START' | 'AUTH_OK' | 'SESSION_FOUND' | 'CONNECTED' | 'SPAWNED' | 'READY' | 'ERROR' | 'DISCONNECT' | 'RETRY';
const transitions: Record<ConnectionState, Partial<Record<ConnectionEvent, ConnectionState>>> = {
  disconnected: { START: 'authenticating' },
  authenticating: { AUTH_OK: 'discovering', ERROR: 'failed', DISCONNECT: 'disconnected' },
  discovering: { SESSION_FOUND: 'connecting', ERROR: 'failed', DISCONNECT: 'disconnected' },
  connecting: { CONNECTED: 'spawned', ERROR: 'failed', DISCONNECT: 'disconnected' },
  spawned: { SPAWNED: 'ready', ERROR: 'failed', DISCONNECT: 'disconnected' },
  ready: { ERROR: 'failed', DISCONNECT: 'disconnected' },
  failed: { RETRY: 'authenticating', DISCONNECT: 'disconnected' }
};
export class ConnectionMachine {
  private current: ConnectionState = 'disconnected';
  get state(): ConnectionState { return this.current; }
  transition(event: ConnectionEvent): ConnectionState {
    const next = transitions[this.current][event];
    if (!next) throw new Error(`Invalid connection transition: ${this.current} + ${event}`);
    this.current = next;
    return next;
  }
}
