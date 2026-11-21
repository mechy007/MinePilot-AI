import type { MinecraftAdapter } from '../minecraft/adapter.js';

export type Position = { x: number; y: number; z: number };
export interface BotObservation {
  position: Position;
  health: number;
  hunger: number;
  drowning?: boolean;
  burning?: boolean;
  inLava?: boolean;
  safePosition?: Position;
}
export interface BotRuntimeAdapter extends MinecraftAdapter {
  observe(): Promise<BotObservation>;
}
export interface RuntimeStep {
  tick: number;
  mode: 'idle' | 'survival' | 'moving';
  target?: Position;
}

/**
 * Android-facing orchestration boundary. Calls real adapter methods only;
 * does not claim a working RakNet/Xbox implementation.
 * Serializes steps to prevent overlapping network movement commands.
 */
export class BotRuntime {
  private tickNumber = 0;
  private connected = false;
  private running = false;
  private target: Position | null = null;
  private controller = new AbortController();
  constructor(private readonly adapter: BotRuntimeAdapter) {}
  get isConnected(): boolean { return this.connected; }
  setTarget(target: Position | null): void {
    if (target && ![target.x, target.y, target.z].every(Number.isFinite)) throw new TypeError('Invalid target');
    this.target = target ? { ...target } : null;
  }
  async connect(): Promise<void> {
    if (this.connected) throw new Error('Already connected');
    this.controller = new AbortController();
    await this.adapter.connect();
    this.connected = true;
  }
  async step(): Promise<RuntimeStep> {
    if (!this.connected) throw new Error('Not connected');
    if (this.running) throw new Error('Runtime step already in progress');
    this.running = true;
    try {
      const observation = await this.adapter.observe();
      if (this.controller.signal.aborted) throw new Error('Runtime stopped');
      const tick = ++this.tickNumber;
      const emergency = observation.drowning || observation.burning || observation.inLava || observation.health <= 0;
      if (emergency) {
        if (observation.safePosition && [observation.safePosition.x, observation.safePosition.y, observation.safePosition.z].every(Number.isFinite)) {
          await this.adapter.moveToward(observation.safePosition, this.controller.signal);
          return { tick, mode: 'survival', target: observation.safePosition };
        }
        return { tick, mode: 'survival' }; // Never follow an ordinary target during danger.
      }
      if (!this.target) return { tick, mode: 'idle' };
      await this.adapter.moveToward(this.target, this.controller.signal);
      return { tick, mode: 'moving', target: { ...this.target } };
    } finally { this.running = false; }
  }
  async disconnect(): Promise<void> {
    this.controller.abort();
    this.target = null;
    try { if (this.connected) await this.adapter.disconnect(); }
    finally { this.connected = false; }
  }
}
