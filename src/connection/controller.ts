import { ConnectionMachine, type ConnectionEvent, type ConnectionState } from './state-machine.js';
import { ConnectionDiagnostics, type DiagnosticLevel } from './diagnostics.js';
import { retryDelay, waitForRetry, type RetryPolicy, DEFAULT_RETRY_POLICY } from './retry.js';

export interface ConnectionDriver {
  authenticate(signal: AbortSignal): Promise<void>;
  discoverOwnerSession(signal: AbortSignal): Promise<void>;
  connect(signal: AbortSignal): Promise<void>;
  waitForSpawn(signal: AbortSignal): Promise<void>;
}
export class ConnectionController {
  readonly machine = new ConnectionMachine();
  readonly diagnostics = new ConnectionDiagnostics();
  private aborter: AbortController | null = null;
  constructor(private readonly driver: ConnectionDriver, private readonly policy: RetryPolicy = DEFAULT_RETRY_POLICY) {}
  get state(): ConnectionState { return this.machine.state; }
  stop(): void {
    this.aborter?.abort();
    if (this.machine.state !== 'disconnected') this.change('DISCONNECT');
  }
  private change(event: ConnectionEvent): void {
    const next = this.machine.transition(event);
    this.diagnostics.record(next, 'info', 'STATE_' + next.toUpperCase());
  }
  private report(level: DiagnosticLevel, code: string): void { this.diagnostics.record(this.state, level, code); }
  async start(): Promise<void> {
    if (this.aborter) throw new Error('Connection controller already running');
    if (this.state !== 'disconnected') throw new Error('Disconnect before restarting');
    const aborter = new AbortController();
    this.aborter = aborter;
    try {
      let failures = 0;
      this.change('START');
      while (!aborter.signal.aborted) {
        try {
          await this.driver.authenticate(aborter.signal);
          if (aborter.signal.aborted) break;
          this.change('AUTH_OK');
          await this.driver.discoverOwnerSession(aborter.signal);
          if (aborter.signal.aborted) break;
          this.change('SESSION_FOUND');
          await this.driver.connect(aborter.signal);
          if (aborter.signal.aborted) break;
          this.change('CONNECTED');
          await this.driver.waitForSpawn(aborter.signal);
          if (aborter.signal.aborted) break;
          this.change('SPAWNED');
          return;
        } catch {
          if (aborter.signal.aborted) break;
          this.change('ERROR');
          this.report('warning', 'CONNECTION_ATTEMPT_FAILED');
          const delay = retryDelay(++failures, this.policy);
          if (delay === null) { this.report('error', 'RETRIES_EXHAUSTED'); return; }
          await waitForRetry(delay, aborter.signal).catch(() => undefined);
          if (aborter.signal.aborted) break;
          this.change('RETRY');
        }
      }
    } finally {
      if (aborter.signal.aborted && this.state !== 'disconnected') this.change('DISCONNECT');
      this.aborter = null;
    }
  }
}
