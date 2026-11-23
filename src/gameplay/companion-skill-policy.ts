/**
 * Original transport-independent safety policy based on general companion design
 * principles. Not copied from any Minecraft add-on or Script API implementation.
 * Every output is a proposed UI action. No movement or item packet emission.
 */
export type CompanionContext = Readonly<{
  spawned: boolean;
  positionKnown: boolean;
  chunkHeaders: number;
  playerGameMode?: string;
  loadingPacketsSent?: number;
  loadingErrors?: number;
  movementAuthority?: number | null;
  safetyHold: boolean;
  survivalReason: string;
  taskStatus: string;
  isNight?: boolean | null;
  foodOptions: number;
  buildStatus: string;
  workflowStatus: string;
}>;
export type CompanionCue = Readonly<{
  urgency: 'block' | 'caution' | 'informational';
  action: 'stop' | 'review_spawn' | 'review_game_mode' | 'review_movement' |
    'review_water_escape' | 'review_shelter' | 'plan_food' | 'review_task' | 'inspect';
  reason: string;
  requiresUserApproval: true;
  executed: false;
}>;
const cue = (urgency: CompanionCue['urgency'],
             action: CompanionCue['action'], reason: string): CompanionCue =>
  ({ urgency, action, reason, requiresUserApproval: true, executed: false });

/**
 * Deterministic priority ordering:
 * emergency stop > incomplete presence > hostile-invisible game modes >
 * unverified input authority > drowning warning > hunger > task recovery >
 * nighttime shelter reminder > inspect.
 *
 * An absent observation never becomes fabricated terrain or an action.
 */
export function evaluateCompanionCues(world: CompanionContext): CompanionCue {
  if (world.safetyHold) return cue('block', 'stop', 'critical_survival_override');
  if (!world.spawned || !world.positionKnown || world.chunkHeaders < 1)
    return cue('block', 'review_spawn', 'spawn_or_chunks_not_observed');
  const mode = world.playerGameMode;
  if (mode === 'creative' || mode === 'spectator' ||
      mode === 'survival_spectator' || mode === 'creative_spectator')
    return cue('caution', 'review_game_mode', 'hostile_mobs_may_ignore_game_mode');
  if (world.loadingErrors && world.loadingErrors > 0)
    return cue('caution', 'review_spawn', 'loading_handshake_write_failed');
  if (world.loadingPacketsSent !== undefined && world.loadingPacketsSent < 2)
    return cue('caution', 'review_spawn', 'loading_handshake_not_complete');
  if (world.movementAuthority !== undefined &&
      world.movementAuthority !== 1 && world.movementAuthority !== 2)
    return cue('caution', 'review_movement', 'movement_authority_not_available');
  if (world.survivalReason === 'air_supply_decreasing')
    return cue('caution', 'review_water_escape', 'air_supply_decreasing_no_water_map');
  if (world.survivalReason === 'low_hunger' && world.foodOptions > 0)
    return cue('caution', 'plan_food', 'verified_food_available');
  if (world.taskStatus === 'paused' || world.taskStatus === 'ready_to_replan')
    return cue('caution', 'review_task', 'task_interruption_needs_review');
  if (world.buildStatus === 'materials_missing')
    return cue('informational', 'review_task', 'building_material_shortage');
  if (world.isNight === true)
    return cue('informational', 'review_shelter', 'night_shelter_advisory');
  if (world.workflowStatus === 'waiting_for_verification')
    return cue('informational', 'review_task', 'workflow_requires_verification');
  return cue('informational', 'inspect', 'observation_only');
}

/**
 * A small in-memory lease for future verified movement/work actions.
 * It never calls the game client; emergency priority wins, and expiration
 * prevents an old job from retaining movement ownership indefinitely.
 */
export class CompanionIntentLease {
  private lease: { owner: string; priority: number; expiresAt: number } | null = null;
  private readonly clock: () => number;
  constructor(clock: () => number = Date.now) { this.clock = clock; }
  reset(): void { this.lease = null; }
  acquire(owner: unknown, priority: unknown, ttlMs: unknown): {
    accepted: boolean; reason: string
  } {
    if (typeof owner !== 'string' || !/^[a-z_]{1,24}$/.test(owner) ||
        typeof priority !== 'number' || !Number.isInteger(priority) ||
        priority < 0 || priority > 100 ||
        typeof ttlMs !== 'number' || !Number.isInteger(ttlMs) ||
        ttlMs < 100 || ttlMs > 5000)
      return { accepted: false, reason: 'invalid_lease_request' };
    const now = this.clock();
    if (!Number.isFinite(now) || now < 0)
      return { accepted: false, reason: 'invalid_clock' };
    if (this.lease && this.lease.expiresAt > now &&
        this.lease.owner !== owner && priority <= this.lease.priority)
      return { accepted: false, reason: 'owned_by_higher_priority_task' };
    this.lease = { owner, priority, expiresAt: now + ttlMs };
    return { accepted: true, reason: 'lease_reserved_not_executed' };
  }
  release(owner: string): boolean {
    if (this.lease?.owner !== owner) return false;
    this.lease = null;
    return true;
  }
  stop(): void { this.lease = null; }
  snapshot(): { owner: string | null; priority: number | null; expiresInMs: number; executed: false } {
    const now = this.clock();
    const active = this.lease && this.lease.expiresAt > now ? this.lease : null;
    return { owner: active?.owner ?? null, priority: active?.priority ?? null,
      expiresInMs: active ? Math.max(0, active.expiresAt - now) : 0, executed: false };
  }
}
