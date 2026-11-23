/**
 * MinePilot movement arbitration (original implementation, inspired by the
 * concept of a shared navigation authority; no addon source is copied).
 * This selects a desired motion. It does NOT send Bedrock packets.
 */
export type NavigationSource =
  | 'emergency' | 'survival' | 'manual' | 'combat'
  | 'task' | 'follow' | 'explore' | 'wander';

export type NavigationPoint = Readonly<{ x: number; y: number; z: number }>;
export type NavigationMode = 'walk' | 'sprint' | 'sneak' | 'swim';
export type NavigationRequest = Readonly<{
  source: NavigationSource;
  target?: NavigationPoint;
  mode: NavigationMode;
  hold: boolean;
  reason?: string;
  expiresAt: number;
}>;

const PRIORITY: Readonly<Record<NavigationSource, number>> = {
  emergency: 100, survival: 90, manual: 80, combat: 70,
  task: 60, follow: 50, explore: 30, wander: 10
};
const MAX_TTL_MS = 30_000;
const MIN_TTL_MS = 50;
type Pending = { request: NavigationRequest; revision: number };

function validPoint(point: NavigationPoint | undefined): boolean {
  return point !== undefined && [point.x, point.y, point.z].every(Number.isFinite);
}

/** One movement owner at a time; TTLs prevent abandoned tasks moving the bot. */
export class NavigationAuthority {
  private readonly requested = new Map<NavigationSource, Pending>();
  private revision = 0;
  private haltReason: string | null = null;

  /** Submit one request per source; submitting again replaces its previous request. */
  request(
    source: NavigationSource,
    target: NavigationPoint | undefined,
    options: { mode?: NavigationMode; hold?: boolean; ttlMs?: number; reason?: string } = {},
    nowMs: number = Date.now()
  ): void {
    if (!(source in PRIORITY)) throw new Error('Unsupported navigation source');
    if (!Number.isFinite(nowMs)) throw new RangeError('Invalid timestamp');
    if (target !== undefined && !validPoint(target)) throw new RangeError('Invalid target position');
    const ttl = options.ttlMs ?? 1000;
    if (!Number.isFinite(ttl) || ttl < MIN_TTL_MS || ttl > MAX_TTL_MS)
      throw new RangeError('Navigation request lifetime out of range');
    if (!target && !options.hold) throw new Error('Request requires a target or hold');
    const mode = options.mode ?? 'walk';
    if (!['walk', 'sprint', 'sneak', 'swim'].includes(mode))
      throw new Error('Unsupported movement mode');
    const request: NavigationRequest = {
      source, ...(target ? { target: { ...target } } : {}), mode,
      hold: !!options.hold, ...(options.reason ? { reason: options.reason } : {}),
      expiresAt: nowMs + ttl
    };
    this.requested.set(source, { request, revision: ++this.revision });
  }

  /** Emergency stop persists until clearEmergency(); no command can override it. */
  emergencyStop(reason: string): void {
    this.haltReason = reason || 'Emergency stop';
  }

  clearEmergency(): void { this.haltReason = null; }
  release(source: NavigationSource): void { this.requested.delete(source); }
  clear(): void { this.requested.clear(); this.haltReason = null; }

  selected(nowMs: number = Date.now()):
    | { kind: 'stop'; reason: string }
    | { kind: 'move'; owner: NavigationSource; request: NavigationRequest } {
    if (this.haltReason) return { kind: 'stop', reason: this.haltReason };
    for (const [source, pending] of this.requested)
      if (pending.request.expiresAt <= nowMs) this.requested.delete(source);
    let selected: Pending | undefined;
    for (const pending of this.requested.values()) {
      if (!selected ||
          PRIORITY[pending.request.source] > PRIORITY[selected.request.source] ||
          (PRIORITY[pending.request.source] === PRIORITY[selected.request.source] && pending.revision > selected.revision))
        selected = pending;
    }
    if (!selected) return { kind: 'stop', reason: 'No active movement request' };
    return { kind: 'move', owner: selected.request.source, request: selected.request };
  }
}
