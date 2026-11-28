import { createRequire } from 'node:module';

export interface WorldSessionCandidate {
  id?: string;
  sessionRef: { name: string };
  ownerXuid?: string;
  customProperties?: { ownerId?: string; protocol?: string | number; [key: string]: unknown };
}

const FRIEND_WORLD_VERSION = '1.26.60';
const FRIEND_WORLD_PROTOCOL = 2225;
export interface BedrockClientLike {
  on(event: string, listener: (...args: unknown[]) => void): this;
  removeListener(event: string, listener: (...args: unknown[]) => void): this;
  close(): void;
}
export type BedrockClientFactory = (options: {
  username: string;
  offline: false;
  version: string;
  profilesFolder?: string | false;
  onMsaCode?: (code: { user_code?: string; verification_uri?: string; verification_uri_complete?: string; message?: string }) => void;
  /** A signed-in prismarine-auth Authflow. When set, bedrock-protocol reuses it instead of starting its own login. */
  authflow?: unknown;
  world: { pickSession: (sessions: WorldSessionCandidate[]) => WorldSessionCandidate };
}) => BedrockClientLike;

/** Selects by exact owner XUID, never by mutable gamertag or list order. */
export function pickOwnerWorld(sessions: readonly WorldSessionCandidate[], ownerXuid: string): WorldSessionCandidate {
  if (!/^\d+$/.test(ownerXuid)) throw new Error('Invalid owner XUID');
  const matches = sessions.filter(session => {
    const advertisedOwner = session.ownerXuid;
    const customOwner = session.customProperties?.ownerId;
    const ownerMatches = (advertisedOwner === undefined || advertisedOwner === ownerXuid) &&
      (customOwner === undefined || customOwner === ownerXuid) &&
      (advertisedOwner === ownerXuid || customOwner === ownerXuid);
    return ownerMatches && typeof session.id === 'string' && session.id.trim().length > 0 &&
      typeof session.sessionRef?.name === 'string' && session.sessionRef.name.trim().length > 0;
  });
  if (matches.length === 0) throw new Error('Owner world not found or XUID not exposed');
  // The SDK queries and joins within its fixed Minecraft service configuration and lobby template.
  if (new Set(matches.map(session => session.sessionRef.name)).size !== 1) {
    throw new Error('Ambiguous owner world');
  }
  const incompatible = matches.some(session => {
    const protocol = session.customProperties?.protocol;
    return protocol !== undefined && String(protocol) !== String(FRIEND_WORLD_PROTOCOL);
  });
  if (incompatible) {
    throw new Error(`Friend world protocol mismatch: expected ${FRIEND_WORLD_PROTOCOL} (${FRIEND_WORLD_VERSION})`);
  }
  return matches[0];
}

/**
 * Legacy Node-side adapter retained for isolated SDK experiments. Android's production
 * path uses the explicit MPSD handle/RTA/nonce join flow in android-friend-world-join.cjs.
 * This adapter is not proof of friend-world interoperability.
 */
export class PrismarineWorldClient {
  private client: BedrockClientLike | null = null;
  private startGamePacket: unknown = null;
  private lastError: Error | null = null;
  get connectionError(): Error | null { return this.lastError; }
  get lastStartGamePacket(): unknown { return this.startGamePacket; }
  private readonly onStartGame = (...args: unknown[]) => { this.startGamePacket = args[0]; };
  get activeClient(): BedrockClientLike | null { return this.client; }
  constructor(
    private readonly username: string,
    private readonly ownerXuid: string,
    private readonly createClient: BedrockClientFactory = loadBedrockClient,
    private readonly auth?: { profilesFolder?: string | false; onMsaCode?: Parameters<BedrockClientFactory>[0]['onMsaCode']; authflow?: unknown }
  ) {}
  async connectAndSpawn(signal: AbortSignal, timeoutMs = 45000): Promise<void> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new RangeError('Invalid join timeout');
    if (this.client) throw new Error('Already connected');
    if (signal.aborted) throw new Error('Connection cancelled');
    this.lastError = null;
    const client = this.createClient({
      username: this.username,
      offline: false,
      version: FRIEND_WORLD_VERSION,
      ...this.auth,
      world: { pickSession: sessions => pickOwnerWorld(sessions, this.ownerXuid) }
    });
    this.client = client;
    this.startGamePacket = null;
    client.on('start_game', this.onStartGame);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => done(new Error('Timed out waiting for friend-world spawn')), timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        client.removeListener('spawn', spawned);
        client.removeListener('error', failed);
        client.removeListener('close', closed);
        signal.removeEventListener('abort', aborted);
      };
      const done = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) {
          this.lastError = error;
          this.client = null;
          client.removeListener('start_game', this.onStartGame);
          client.close();
          reject(error);
        } else resolve();
      };
      const spawned = () => done();
      const failed = (...args: unknown[]) => {
        const error = args[0];
        done(new Error(error instanceof Error ? `Bedrock connection failed: ${error.message}` : 'Bedrock connection failed'));
      };
      const closed = () => done(new Error('Bedrock connection closed before spawn'));
      const aborted = () => done(new Error('Connection cancelled'));
      client.on('spawn', spawned);
      client.on('error', failed);
      client.on('close', closed);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
    });
  }
  disconnect(): void {
    const client = this.client;
    this.client = null;
    this.startGamePacket = null;
    client?.removeListener('start_game', this.onStartGame);
    client?.close();
  }
}

function loadBedrockClient(options: Parameters<BedrockClientFactory>[0]): BedrockClientLike {
  const require = createRequire(import.meta.url);
  const protocol = require('bedrock-protocol') as { createClient: BedrockClientFactory };
  return protocol.createClient(options);
}
