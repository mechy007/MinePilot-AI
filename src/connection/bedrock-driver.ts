import type { ConnectionDriver } from './controller.js';
import { selectOwnerSession, type FriendSession } from './session-selection.js';

export interface BedrockSessionTransport {
  authenticate(signal: AbortSignal): Promise<void>;
  listFriendSessions(signal: AbortSignal): Promise<readonly FriendSession[]>;
  join(session: FriendSession, signal: AbortSignal): Promise<void>;
  awaitSpawn(signal: AbortSignal): Promise<void>;
}
export class BedrockConnectionDriver implements ConnectionDriver {
  private session: FriendSession | null = null;
  constructor(private readonly transport: BedrockSessionTransport, private readonly ownerXuid: string) {}
  authenticate(signal: AbortSignal): Promise<void> {
    this.session = null;
    return this.transport.authenticate(signal);
  }
  async discoverOwnerSession(signal: AbortSignal): Promise<void> {
    const sessions = await this.transport.listFriendSessions(signal);
    if (signal.aborted) throw new Error('Connection cancelled');
    this.session = selectOwnerSession(sessions, this.ownerXuid);
  }
  async connect(signal: AbortSignal): Promise<void> {
    if (!this.session) throw new Error('No selected owner session');
    if (signal.aborted) throw new Error('Connection cancelled');
    await this.transport.join(this.session, signal);
  }
  async waitForSpawn(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error('Connection cancelled');
    await this.transport.awaitSpawn(signal);
  }
}
