/** Layer 1 vertical slice: navigation arbitration + read-only inventory + task state.
 * Original transport-independent code. No addon scripts/assets are copied.
 * Movement is never declared successful until server-observed position changes.
 */
import { NavigationAuthority, type NavigationSource } from './navigation-authority.js';
import { decideGameplay, type Vec3 } from './companion-engine.js';

export type LayerOneTaskType = 'inspect' | 'wait' | 'probe_step';
export type LayerOneTaskState =
  | 'waiting_for_world' | 'running' | 'awaiting_server_verification'
  | 'completed' | 'unverified' | 'paused_by_safety' | 'cancelled';
export type LayerOneTask = Readonly<{
  type: LayerOneTaskType;
  state: LayerOneTaskState;
  startedAt: number;
  reason: string;
}>;

type InventoryPacket = {
  window_id?: unknown;
  container_id?: unknown;
  input?: unknown;
  slots?: unknown;
};
type Vitals = { health?: number; hunger?: number; maxHealth?: number };
type WorldInfo = {
  position: Vec3 | null;
  chunks: number;
  spawned: boolean;
};
type InventorySummary = {
  known: boolean;
  slotCount: number;
  occupiedSlots: number;
  observedAt: number | null;
};

const isVec = (p: unknown): p is Vec3 => {
  if (!p || typeof p !== 'object') return false;
  const q = p as Partial<Vec3>;
  return [q.x, q.y, q.z].every(n => typeof n === 'number' && Number.isFinite(n));
};
const validNow = (n: number): void => {
  if (!Number.isFinite(n) || n < 0) throw new RangeError('Invalid time');
};

export class LayerOneController {
  private readonly navigation = new NavigationAuthority();
  private readonly clock: () => number;
  private active: LayerOneTask | null = null;
  private origin: Vec3 | null = null;
  private waiting = false;
  private safetyHold = false;
  private inventorySummary: InventorySummary = { known: false, slotCount: 0, occupiedSlots: 0, observedAt: null };
  private vitals: Vitals = {};
  private lastObservedPosition: Vec3 | null = null;

  constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }

  private now(): number {
    const now = this.clock();
    validNow(now);
    return now;
  }

  reset(): void {
    this.navigation.clear();
    this.active = null;
    this.origin = null;
    this.waiting = false;
    this.safetyHold = false;
    this.inventorySummary = { known: false, slotCount: 0, occupiedSlots: 0, observedAt: null };
    this.vitals = {};
    this.lastObservedPosition = null;
  }

  /** Only accepts the bot's own already-validated vitals, never another entity's. */
  onVitals(vitals: Vitals): boolean {
    for (const key of ['health', 'hunger', 'maxHealth'] as const) {
      const value = vitals[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100)
        this.vitals[key] = value;
    }
    const before = this.safetyHold;
    // Critical state takes precedence over an active task. Unknown vitals do not imply safety.
    this.safetyHold = this.vitals.health !== undefined && this.vitals.health <= 6;
    if (this.safetyHold) {
      this.navigation.request('survival', undefined,
        { hold: true, ttlMs: 30_000, reason: 'critical_health' }, this.now());
      if (this.active && (this.active.state === 'running' || this.active.state === 'awaiting_server_verification')) {
        this.active = { ...this.active, state: 'paused_by_safety', reason: 'critical_health' };
      }
    } else {
      this.navigation.release('survival');
    }
    return !before && this.safetyHold;
  }

  /** Read-only item counts. No item names, tokens, raw stack data or writes. */
  onInventory(packet: InventoryPacket): boolean {
    if (!packet || typeof packet !== 'object') return false;
    const window = packet.window_id ?? packet.container_id;
    if (!(window === 0 || window === 'inventory')) return false;
    const slots = Array.isArray(packet.input) ? packet.input :
      Array.isArray(packet.slots) ? packet.slots : null;
    if (!slots || slots.length > 128) return false;
    let occupied = 0;
    for (const slot of slots) {
      if (!slot || typeof slot !== 'object') continue;
      const entry = slot as { count?: unknown; network_id?: unknown; id?: unknown; item?: { count?: unknown; network_id?: unknown; id?: unknown } };
      const count = entry.count ?? entry.item?.count;
      const identity = entry.network_id ?? entry.id ?? entry.item?.network_id ?? entry.item?.id;
      if (typeof count === 'number' && Number.isInteger(count) && count > 0 && count <= 127 &&
          identity !== undefined && identity !== null && identity !== 0 && identity !== 'air') occupied++;
    }
    this.inventorySummary = { known: true, slotCount: slots.length,
      occupiedSlots: occupied, observedAt: this.now() };
    return true;
  }

  onServerPosition(position: unknown): void {
    if (!isVec(position)) return;
    this.lastObservedPosition = { ...position };
    if (this.active?.type !== 'probe_step' || this.active.state !== 'awaiting_server_verification' || !this.origin) return;
    const distance = Math.hypot(position.x - this.origin.x, position.y - this.origin.y, position.z - this.origin.z);
    if (distance >= 0.12) {
      this.active = { ...this.active, state: 'completed', reason: 'server_position_changed' };
      this.navigation.release('manual');
      this.origin = null;
    }
  }

  inspect(world: WorldInfo): { status: string; reason: string } {
    const now = this.now();
    if (!world.spawned || !isVec(world.position)) {
      this.active = { type: 'inspect', state: 'waiting_for_world', startedAt: now, reason: 'world_not_ready' };
      return { status: 'rejected', reason: 'world_not_ready' };
    }
    const assessment = decideGameplay({
      position: world.position,
      ...(this.vitals.health !== undefined ? { health: this.vitals.health } : {}),
      ...(this.vitals.hunger !== undefined ? { hunger: this.vitals.hunger } : {}),
      ...(this.vitals.maxHealth !== undefined ? { maxHealth: this.vitals.maxHealth } : {})
    }, { type: 'idle' });
    const reason = assessment.reason === 'Survival override' || assessment.reason === 'Low hunger'
      ? 'inspection_safety_warning' : 'inspection_complete';
    this.active = { type: 'inspect', state: 'completed', startedAt: now, reason };
    return { status: 'ok', reason };
  }

  wait(): { status: string; reason: string } {
    if (this.safetyHold) return { status: 'rejected', reason: 'critical_health' };
    const now = this.now();
    this.waiting = true;
    this.origin = null;
    this.navigation.release('manual');
    this.navigation.request('manual', undefined, { hold: true, ttlMs: 30_000, reason: 'user_wait' }, now);
    this.active = { type: 'wait', state: 'running', startedAt: now, reason: 'waiting_for_user' };
    return { status: 'accepted', reason: 'waiting_for_user' };
  }

  canProbe(world: WorldInfo): { allowed: boolean; reason: string } {
    if (this.waiting) return { allowed: false, reason: 'wait_mode_active' };
    if (this.safetyHold) return { allowed: false, reason: 'critical_health' };
    if (!world.spawned || !isVec(world.position) || world.chunks <= 0)
      return { allowed: false, reason: 'world_not_ready' };
    return { allowed: true, reason: 'eligible' };
  }

  beginProbe(world: WorldInfo): { status: string; reason: string } {
    const validation = this.canProbe(world);
    if (!validation.allowed) return { status: 'rejected', reason: validation.reason };
    const now = this.now();
    const position = world.position!;
    this.navigation.request('manual', position, { ttlMs: 4000, reason: 'experimental_probe' }, now);
    const selection = this.navigation.selected(now);
    if (selection.kind !== 'move' || selection.owner !== 'manual') {
      this.navigation.release('manual');
      return { status: 'rejected', reason: 'movement_preempted' };
    }
    this.active = { type: 'probe_step', state: 'running', startedAt: now, reason: 'input_not_yet_queued' };
    this.origin = { ...position };
    return { status: 'accepted', reason: 'probe_intent_accepted' };
  }

  probeQueued(): void {
    if (this.active?.type !== 'probe_step' || this.active.state !== 'running') return;
    this.active = { ...this.active, state: 'awaiting_server_verification', reason: 'awaiting_server_position' };
  }

  probeFailed(reason = 'input_not_accepted'): void {
    if (this.active?.type !== 'probe_step') return;
    this.active = { ...this.active, state: 'unverified', reason };
    this.origin = null;
    this.navigation.release('manual');
  }

  stop(reason = 'user_stopped'): void {
    this.navigation.clear();
    this.active = this.active ? { ...this.active, state: 'cancelled', reason } : null;
    this.waiting = false;
    this.origin = null;
    // User stop cancels movement; it never clears server-reported critical-health state.
  }

  snapshot(): {
    task: LayerOneTask | null;
    movementOwner: NavigationSource | null;
    inventory: InventorySummary;
    safetyHold: boolean;
  } {
    const now = this.now();
    if (this.waiting && !this.safetyHold) {
      this.navigation.request('manual', undefined, { hold: true, ttlMs: 30_000, reason: 'user_wait' }, now);
    }
    if (this.safetyHold) {
      this.navigation.request('survival', undefined, { hold: true, ttlMs: 30_000, reason: 'critical_health' }, now);
    }
    if (this.active?.type === 'probe_step' && this.active.state === 'awaiting_server_verification' &&
        now - this.active.startedAt >= 7000) {
      this.probeFailed('no_server_position_confirmation');
    }
    const selection = this.navigation.selected(now);
    return {
      task: this.active ? { ...this.active } : null,
      movementOwner: selection.kind === 'move' ? selection.owner : null,
      inventory: { ...this.inventorySummary },
      safetyHold: this.safetyHold
    };
  }
}
