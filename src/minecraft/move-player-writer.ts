import type { BedrockClientLike } from '../connection/prismarine-world-client.js';
import type { BedrockMovementWriter } from './prismarine-runtime-adapter.js';
import type { Position } from '../core/bot-runtime.js';

/** Outbound Bedrock move_player packet adapter for clients exposing queue(). */
export interface MovementPacketClient extends BedrockClientLike {
  queue(packet: string, payload: Record<string, unknown>): void;
}
export interface MovementSession {
  runtimeEntityId: bigint | number | string;
  position: Position;
  tick: bigint;
}
/**
 * Sends a bounded, incremental move_player packet rather than teleporting to
 * the requested destination. Servers may reject movement if they require
 * player_auth_input; validate negotiated protocol before enabling in production.
 */
export class MovePlayerPacketWriter implements BedrockMovementWriter {
  constructor(
    private readonly session: () => MovementSession | null,
    private readonly maxStep = 0.25
  ) {
    if (!Number.isFinite(maxStep) || maxStep <= 0 || maxStep > 0.5) throw new RangeError('Unsafe movement step');
  }
  async move(client: BedrockClientLike, target: Position, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error('Movement cancelled');
    const state = this.session();
    if (!state) throw new Error('Bedrock movement session not initialized');
    const sender = client as Partial<MovementPacketClient>;
    if (typeof sender.queue !== 'function') throw new Error('Bedrock client has no packet queue');
    if (![target.x,target.y,target.z,state.position.x,state.position.y,state.position.z].every(Number.isFinite)) throw new Error('Invalid movement coordinates');
    const dx = target.x - state.position.x, dy = target.y - state.position.y, dz = target.z - state.position.z;
    const distance = Math.hypot(dx,dy,dz);
    if (distance === 0) return;
    const ratio = Math.min(1,this.maxStep/distance);
    const position = {
      x: state.position.x + dx*ratio,
      y: state.position.y + dy*ratio,
      z: state.position.z + dz*ratio
    };
    const yaw = Math.atan2(-dx,dz)*180/Math.PI;
    if (signal.aborted) throw new Error('Movement cancelled');
    sender.queue('move_player', {
      runtime_id: state.runtimeEntityId,
      position,
      pitch: 0,
      yaw,
      head_yaw: yaw,
      mode: 'normal',
      on_ground: false,
      ridden_runtime_id: 0,
      teleport_cause: 0,
      teleport_source_entity_type: 0,
      tick: state.tick
    });
  }
}
