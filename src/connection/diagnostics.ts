import type { ConnectionState } from './state-machine.js';
export type DiagnosticLevel = 'info' | 'warning' | 'error';
export interface DiagnosticEvent { timestamp: number; state: ConnectionState; level: DiagnosticLevel; code: string }
export class ConnectionDiagnostics {
  private readonly events: DiagnosticEvent[] = [];
  constructor(private readonly capacity = 100) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 10000) throw new RangeError('Invalid diagnostic capacity');
  }
  record(state: ConnectionState, level: DiagnosticLevel, code: string, timestamp = Date.now()): void {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(code)) throw new Error('Diagnostic code must be a safe constant');
    if (!Number.isFinite(timestamp)) throw new RangeError('Invalid timestamp');
    this.events.push(Object.freeze({ timestamp, state, level, code }));
    if (this.events.length > this.capacity) this.events.shift();
  }
  snapshot(): readonly DiagnosticEvent[] { return this.events.map(e => ({ ...e })); }
  clear(): void { this.events.length = 0; }
}
