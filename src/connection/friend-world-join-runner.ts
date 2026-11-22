import { PrismarineWorldClient, type BedrockClientFactory } from './prismarine-world-client.js';

export type JoinPhase = 'idle' | 'authenticating' | 'spawned' | 'disconnected' | 'failed';
export interface FriendWorldJoinConfig {
  username: string;
  friendOwnerXuid: string;
  profilesFolder?: string | false;
  /** A signed-in Authflow from XboxLoginService. When set, joining reuses it and never starts its own login. */
  authflow?: unknown;
  timeoutMs?: number;
}
export interface FriendWorldJoinEvent {
  phase: JoinPhase;
  message: string;
}

/** Single-session orchestration for an authenticated friend-world client.
 * This is a Node-side runtime, NOT an Android embedded engine. */
export class FriendWorldJoinRunner {
  private readonly world: PrismarineWorldClient;
  private readonly timeoutMs: number;
  private phase: JoinPhase = 'idle';
  private controller: AbortController | null = null;
  private onClose: (() => void) | null = null;
  private onError: ((...args: unknown[]) => void) | null = null;
  private readonly report: (event: FriendWorldJoinEvent) => void;

  constructor(config: FriendWorldJoinConfig, report: (event: FriendWorldJoinEvent) => void,
      factory?: BedrockClientFactory, onMsaCode?: (code: { user_code?: string; verification_uri?: string; verification_uri_complete?: string; message?: string }) => void) {
    if (!config.username.trim()) throw new Error('Xbox username required');
    if (!/^\d{1,20}$/.test(config.friendOwnerXuid)) throw new Error('Friend owner XUID required');
    try { BigInt(config.friendOwnerXuid) <= 18446744073709551615n || (() => { throw new Error('XUID out of range'); })(); }
    catch { throw new Error('XUID out of range'); }
    this.timeoutMs = config.timeoutMs ?? 45000;
    this.report = report;
    this.world = new PrismarineWorldClient(config.username, config.friendOwnerXuid, factory,
      { profilesFolder: config.profilesFolder, onMsaCode, ...(config.authflow ? { authflow: config.authflow } : {}) });
  }
  get state(): JoinPhase { return this.phase; }
  private emit(phase: JoinPhase, message: string): void {
    this.phase = phase;
    this.report({ phase, message });
  }
  async start(): Promise<void> {
    if (this.phase !== 'idle' && this.phase !== 'disconnected' && this.phase !== 'failed') throw new Error('Session already running');
    const controller = new AbortController();
    this.controller = controller;
    this.emit('authenticating', 'Authenticating and discovering friend world');
    try {
      await this.world.connectAndSpawn(controller.signal, this.timeoutMs);
      if (controller.signal.aborted) return;
      const client = this.world.activeClient;
      if (!client) throw new Error('Client missing after spawn');
      this.onClose = () => { if (this.phase === 'spawned') this.emit('disconnected', 'Friend world connection closed'); };
      this.onError = () => { if (this.phase === 'spawned') this.emit('failed', 'Friend world connection error'); };
      client.on('close', this.onClose);
      client.on('error', this.onError);
      this.emit('spawned', 'Spawn packet received; confirm presence in friend world');
    } catch (error) {
      if (!controller.signal.aborted) this.emit('failed', error instanceof Error ? error.message : 'Friend world join failed');
      throw error;
    }
  }
  stop(): void {
    this.controller?.abort();
    const client = this.world.activeClient;
    if (client && this.onClose) client.removeListener('close', this.onClose);
    if (client && this.onError) client.removeListener('error', this.onError);
    this.onClose = null;
    this.onError = null;
    this.world.disconnect();
    if (this.phase !== 'disconnected') this.emit('disconnected', 'Session stopped');
  }
}
