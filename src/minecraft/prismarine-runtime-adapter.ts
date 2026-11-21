import { PrismarineWorldClient, type BedrockClientFactory, type BedrockClientLike } from '../connection/prismarine-world-client.js';
import type { BotRuntimeAdapter, BotObservation, Position } from '../core/bot-runtime.js';
import { MovePlayerPacketWriter, type MovementSession } from './move-player-writer.js';

/** Packet output must be implemented against the negotiated Bedrock protocol version. */
export interface BedrockMovementWriter {
  move(client: BedrockClientLike, target: Position, signal: AbortSignal): Promise<void>;
}
/**
 * Real authenticated Bedrock session -> bot runtime bridge.
 * World state is supplied by decoded packet observers; no fabricated position or health.
 * Until a protocol-verified movement writer is installed, movement fails closed.
 */
export class PrismarineRuntimeAdapter implements BotRuntimeAdapter {
  private readonly world: PrismarineWorldClient;
  private connected = false;
  private observation: BotObservation | null = null;
  private client: BedrockClientLike | null = null;
  private entityId: string | number | bigint | null = null;
  private movementTick = 0n;
  private readonly packetWriter = new MovePlayerPacketWriter(() => this.movementSession());
  private movementSession(): MovementSession | null {
    if (!this.connected || !this.observation || this.entityId === null) return null;
    return { runtimeEntityId: this.entityId, position: this.observation.position, tick: ++this.movementTick };
  }
  constructor(
    username: string,
    ownerXuid: string,
    private readonly writer?: BedrockMovementWriter,
    factory?: BedrockClientFactory
  ) {
    this.world = new PrismarineWorldClient(username, ownerXuid, factory);
  }
  async connect(): Promise<void> {
    if (this.connected) throw new Error('Already connected');
    const abort = new AbortController();
    await this.world.connectAndSpawn(abort.signal);
    this.client = this.world.activeClient;
    if (!this.client) throw new Error('Spawned client unavailable');
    this.client.on('start_game', this.onStartGame);
    this.client.on('move_player', this.onMove);
    this.client.on('update_attributes', this.onAttributes);
    this.client.on('close', this.onClose);
    this.connected = true;
  }
  private readonly onClose = () => { this.connected = false; this.observation = null; this.entityId = null; };
  private readonly onStartGame = (...args: unknown[]) => {
    const packet = args[0] as { runtime_entity_id?: string | number | bigint } | undefined;
    if (packet?.runtime_entity_id !== undefined) this.entityId = packet.runtime_entity_id;
  };
  private readonly onMove = (...args: unknown[]) => {
    const packet = args[0] as { position?: Position } | undefined;
    const p = packet?.position;
    if (!p || ![p.x,p.y,p.z].every(Number.isFinite)) return;
    this.observation = { position: { ...p }, health: this.observation?.health ?? NaN, hunger: this.observation?.hunger ?? NaN };
  };
  private readonly onAttributes = (...args: unknown[]) => {
    const packet = args[0] as { attributes?: Array<{ name?: string; current?: number }> } | undefined;
    if (!this.observation || !Array.isArray(packet?.attributes)) return;
    for (const attr of packet.attributes) {
      if (!Number.isFinite(attr.current)) continue;
      if (attr.name === 'minecraft:health') this.observation.health = attr.current!;
      if (attr.name === 'minecraft:player.hunger') this.observation.hunger = attr.current!;
    }
  };
  async observe(): Promise<BotObservation> {
    if (!this.connected) throw new Error('Not connected');
    const o = this.observation;
    if (!o || !Number.isFinite(o.health) || !Number.isFinite(o.hunger)) throw new Error('World snapshot incomplete; awaiting decoded position and attributes');
    return { ...o, position: { ...o.position } };
  }
  async moveToward(target: Position, signal: AbortSignal): Promise<void> {
    if (!this.connected || !this.client) throw new Error('Not connected');
    if (signal.aborted) throw new Error('Movement cancelled');
    await (this.writer ?? this.packetWriter).move(this.client, target, signal);
  }
  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.connected = false;
    this.observation = null;
    this.entityId = null;
    client?.removeListener('start_game', this.onStartGame);
    client?.removeListener('move_player', this.onMove);
    client?.removeListener('update_attributes', this.onAttributes);
    client?.removeListener('close', this.onClose);
    this.world.disconnect();
  }
}
