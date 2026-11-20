import type { BedrockSessionTransport } from './bedrock-driver.js';
import type { FriendSession } from './session-selection.js';

/** SDK-neutral boundary. Implement with a verified Bedrock/Xbox SDK. */
export interface BedrockSdkBridge {
  login(signal: AbortSignal): Promise<void>;
  getFriendSessions(signal: AbortSignal): Promise<readonly FriendSession[]>;
  joinFriendSession(sessionId: string, signal: AbortSignal): Promise<void>;
  waitUntilSpawned(signal: AbortSignal): Promise<void>;
}

/** Real transport wiring, without claiming that an SDK is bundled yet. */
export class SdkBedrockTransport implements BedrockSessionTransport {
  constructor(private readonly sdk: BedrockSdkBridge) {}
  authenticate(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new Error('Connection cancelled'));
    return this.sdk.login(signal);
  }
  async listFriendSessions(signal: AbortSignal): Promise<readonly FriendSession[]> {
    if (signal.aborted) throw new Error('Connection cancelled');
    const sessions = await this.sdk.getFriendSessions(signal);
    if (signal.aborted) throw new Error('Connection cancelled');
    if (!Array.isArray(sessions) || !sessions.every(s =>
      typeof s?.sessionId === 'string' && s.sessionId.length > 0 &&
      typeof s.hostXuid === 'string' && /^\d+$/.test(s.hostXuid))) {
      throw new Error('Invalid Xbox session metadata');
    }
    return sessions.map(s => ({ sessionId: s.sessionId, hostXuid: s.hostXuid, ...(s.hostGamertag === undefined ? {} : { hostGamertag: s.hostGamertag }) }));
  }
  async join(session: FriendSession, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error('Connection cancelled');
    await this.sdk.joinFriendSession(session.sessionId, signal);
    if (signal.aborted) throw new Error('Connection cancelled');
  }
  async awaitSpawn(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error('Connection cancelled');
    await this.sdk.waitUntilSpawned(signal);
    if (signal.aborted) throw new Error('Connection cancelled');
  }
}
