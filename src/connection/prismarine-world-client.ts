import { createRequire } from 'node:module';

export interface WorldSessionCandidate {
  hostXuid?: string;
  customProperties?: { hostXuid?: string; [key: string]: unknown };
  [key: string]: unknown;
}
export interface BedrockClientLike {
  on(event: string, listener: (...args: unknown[]) => void): this;
  removeListener(event: string, listener: (...args: unknown[]) => void): this;
  close(): void;
}
export type BedrockClientFactory = (options: {
  username: string;
  offline: false;
  world: { pickSession: (sessions: WorldSessionCandidate[]) => WorldSessionCandidate };
}) => BedrockClientLike;

/** Selects by exact owner XUID, never by mutable gamertag or list order. */
export function pickOwnerWorld(sessions: readonly WorldSessionCandidate[], ownerXuid: string): WorldSessionCandidate {
  if (!/^\d+$/.test(ownerXuid)) throw new Error('Invalid owner XUID');
  const matches = sessions.filter(s => s.hostXuid === ownerXuid || s.customProperties?.hostXuid === ownerXuid);
  if (matches.length !== 1) throw new Error(matches.length ? 'Ambiguous owner world' : 'Owner world not found or XUID not exposed');
  return matches[0];
}

/**
 * Uses bedrock-protocol's actual authenticated Xbox world discovery + NetherNet
 * join path. Requires an installed, compatible bedrock-protocol at runtime.
 * Not yet validated on Android or against Minecraft 1.26.66.1.
 */
export class PrismarineWorldClient {
  private client: BedrockClientLike | null = null;
  constructor(
    private readonly username: string,
    private readonly ownerXuid: string,
    private readonly createClient: BedrockClientFactory = loadBedrockClient
  ) {}
  async connectAndSpawn(signal: AbortSignal): Promise<void> {
    if (this.client) throw new Error('Already connected');
    if (signal.aborted) throw new Error('Connection cancelled');
    const client = this.createClient({
      username: this.username,
      offline: false,
      world: { pickSession: sessions => pickOwnerWorld(sessions, this.ownerXuid) }
    });
    this.client = client;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
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
          this.client = null;
          client.close();
          reject(error);
        } else resolve();
      };
      const spawned = () => done();
      const failed = () => done(new Error('Bedrock connection failed'));
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
    client?.close();
  }
}

function loadBedrockClient(options: Parameters<BedrockClientFactory>[0]): BedrockClientLike {
  const require = createRequire(import.meta.url);
  const protocol = require('bedrock-protocol') as { createClient: BedrockClientFactory };
  return protocol.createClient(options);
}
