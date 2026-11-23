/**
 * Layer 2 — read-only companion navigation planning.
 *
 * The player target is selected by an exact observed gamertag, never by proximity.
 * Plans do NOT issue Bedrock movement packets or claim collision-safe paths.
 * Real driving remains gated on device-verified movement and decoded voxels.
 */
import type { Vec3 } from './companion-engine.js';

export type FollowWorld = {
  position: Vec3 | null;
  dimension: number | null;
  spawned: boolean;
  chunks: number;
  safetyHold: boolean;
};

type ObservedPlayer = { id: string; name: string; position: Vec3; seenAt: number; dimension: number };
type Home = { position: Vec3; dimension: number };
type Goal = { type: 'follow'; id: string; name: string } | { type: 'return'; home: Home } | { type: 'stay' };
export type NavigationPreview = {
  status: 'idle' | 'stay' | 'awaiting_world' | 'waiting_for_target' | 'paused_by_safety' |
    'at_target' | 'route_unverified';
  goal: 'follow' | 'return' | 'stay' | null;
  targetName: string | null;
  distance: number | null;
  heading: number | null;
  nextPoint: Vec3 | null;
  reason: string;
  executed: false;
};
type EquipmentSnapshot = { known: boolean; slot: number | null; itemId: string | null; seenAt: number | null };

const MAX_PLAYERS = 64;
const PLAYER_TTL_MS = 8_000;
const FOLLOW_DISTANCE = 3;
const MAX_STEP_DISTANCE = 1.0;
const namePattern = /^[a-zA-Z0-9_ -]{1,24}$/;
const entityPattern = /^\d{1,20}$/;
const finiteVec = (p: unknown): p is Vec3 => {
  if (p == null || typeof p !== 'object') return false;
  const v = p as Partial<Vec3>;
  return [v.x, v.y, v.z].every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 30_000_000);
};
const validDimension = (d: unknown): d is number => Number.isInteger(d) && (d as number) >= -1 && (d as number) <= 2;
const copy = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: p.z });
const status = (goal: Goal | null, state: NavigationPreview['status'], reason: string,
  info: Partial<Pick<NavigationPreview, 'distance' | 'heading' | 'nextPoint'>> = {}): NavigationPreview => ({
  status: state, goal: goal?.type ?? null, targetName: goal?.type === 'follow' ? goal.name : null,
  distance: null, heading: null, nextPoint: null, reason, executed: false, ...info
});

export class LayerTwoPlanner {
  private readonly now: () => number;
  private readonly players = new Map<string, ObservedPlayer>();
  private goal: Goal | null = null;
  private home: Home | null = null;
  private equipment: EquipmentSnapshot = { known: false, slot: null, itemId: null, seenAt: null };

  constructor(now: () => number = Date.now) { this.now = now; }

  reset(): void {
    this.players.clear();
    this.goal = null;
    this.home = null;
    this.equipment = { known: false, slot: null, itemId: null, seenAt: null };
  }

  observePlayer(id: unknown, name: unknown, position: unknown, dimension: unknown): boolean {
    if (typeof id !== 'string' || !entityPattern.test(id) || typeof name !== 'string' ||
      !namePattern.test(name) || !finiteVec(position) || !validDimension(dimension)) return false;
    if (this.players.size >= MAX_PLAYERS && !this.players.has(id)) return false;
    this.players.set(id, { id, name, position: copy(position), dimension, seenAt: this.now() });
    return true;
  }

  movePlayer(id: unknown, position: unknown): void {
    if (typeof id !== 'string' || !finiteVec(position)) return;
    const player = this.players.get(id);
    if (player) { player.position = copy(position); player.seenAt = this.now(); }
  }

  removePlayer(id: unknown): void {
    if (typeof id === 'string') this.players.delete(id);
  }

  /** A changed dimension invalidates all observed entity identities and route goals. */
  dimensionChanged(): void { this.reset(); }

  /** Only the bot's own equipment packet is admitted by the calling bridge. */
  observeEquipment(slot: unknown, rawItemId: unknown): boolean {
    if (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) > 8) return false;
    const value = rawItemId == null ? null : String(rawItemId);
    if (value != null && !/^\d{1,10}$/.test(value)) return false;
    this.equipment = { known: true, slot: slot as number, itemId: value, seenAt: this.now() };
    return true;
  }

  knownPlayers(world: FollowWorld): string[] {
    const current = this.now();
    if (!validDimension(world.dimension)) return [];
    return Array.from(this.players.values())
      .filter(p => p.dimension === world.dimension && current - p.seenAt >= 0 &&
        current - p.seenAt <= PLAYER_TTL_MS)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_PLAYERS)
      .map(p => p.name);
  }

  markHome(world: FollowWorld): { status: string; reason: string } {
    if (!world.spawned || !finiteVec(world.position) || !validDimension(world.dimension))
      return { status: 'rejected', reason: 'world_not_ready' };
    this.home = { position: copy(world.position), dimension: world.dimension };
    return { status: 'ok', reason: 'home_position_recorded' };
  }

  follow(rawName: unknown, world: FollowWorld): { status: string; reason: string } {
    if (!world.spawned || !finiteVec(world.position) || !validDimension(world.dimension) || world.chunks < 1)
      return { status: 'rejected', reason: 'world_not_ready' };
    if (world.safetyHold) return { status: 'rejected', reason: 'critical_health' };
    if (typeof rawName !== 'string' || !namePattern.test(rawName)) return { status: 'rejected', reason: 'invalid_player_name' };
    const targetName = rawName.toLocaleLowerCase('en');
    const timestamp = this.now();
    const matching = Array.from(this.players.values()).filter(p =>
      p.name.toLocaleLowerCase('en') === targetName && p.dimension === world.dimension &&
      timestamp - p.seenAt >= 0 && timestamp - p.seenAt <= PLAYER_TTL_MS);
    if (matching.length !== 1) return { status: 'rejected', reason: matching.length ? 'ambiguous_player' : 'player_not_visible' };
    this.goal = { type: 'follow', id: matching[0].id, name: matching[0].name };
    return { status: 'accepted', reason: 'follow_plan_only' };
  }

  stay(): { status: string; reason: string } {
    this.goal = { type: 'stay' };
    return { status: 'accepted', reason: 'stay_goal_set' };
  }

  returnHome(world: FollowWorld): { status: string; reason: string } {
    if (world.safetyHold) return { status: 'rejected', reason: 'critical_health' };
    if (!this.home || !world.spawned || !finiteVec(world.position) || world.dimension !== this.home.dimension)
      return { status: 'rejected', reason: 'home_unavailable' };
    this.goal = { type: 'return', home: { position: copy(this.home.position), dimension: this.home.dimension } };
    return { status: 'accepted', reason: 'return_plan_only' };
  }

  cancel(): void { this.goal = null; }

  preview(world: FollowWorld): NavigationPreview {
    const goal = this.goal;
    if (!goal) return status(null, 'idle', 'no_goal');
    if (goal.type === 'stay') return status(goal, 'stay', 'hold_position');
    if (world.safetyHold) return status(goal, 'paused_by_safety', 'critical_health');
    if (!world.spawned || !finiteVec(world.position) || !validDimension(world.dimension) || world.chunks <= 0)
      return status(goal, 'awaiting_world', 'world_not_ready');

    let target: Vec3;
    if (goal.type === 'follow') {
      const observed = this.players.get(goal.id);
      const age = observed ? this.now() - observed.seenAt : Infinity;
      if (!observed || observed.dimension !== world.dimension || age < 0 || age > PLAYER_TTL_MS)
        return status(goal, 'waiting_for_target', 'player_position_stale');
      target = observed.position;
    } else {
      if (goal.home.dimension !== world.dimension)
        return status(goal, 'awaiting_world', 'different_dimension');
      target = goal.home.position;
    }
    const origin = world.position;
    const dx = target.x - origin.x, dy = target.y - origin.y, dz = target.z - origin.z;
    const horizontal = Math.hypot(dx, dz);
    const distance = Math.hypot(horizontal, dy);
    const stopDistance = goal.type === 'follow' ? FOLLOW_DISTANCE : 1;
    if (distance <= stopDistance) return status(goal, 'at_target', 'target_within_range', { distance });
    if (Math.abs(dy) > 1.25) return status(goal, 'route_unverified', 'vertical_path_requires_voxel_data', { distance });
    if (horizontal < 0.0001) return status(goal, 'route_unverified', 'zero_horizontal_displacement', { distance });
    const progress = Math.min(MAX_STEP_DISTANCE, Math.max(0, distance - stopDistance)) / horizontal;
    const nextPoint = { x: origin.x + dx * progress, y: origin.y, z: origin.z + dz * progress };
    const heading = ((Math.atan2(-dx, dz) * 180 / Math.PI) % 360 + 360) % 360;
    return status(goal, 'route_unverified', 'direct_route_needs_collision_data',
      { distance: Math.round(distance * 100) / 100, heading: Math.round(heading * 100) / 100, nextPoint });
  }

  snapshot(world: FollowWorld): {
    preview: NavigationPreview;
    visiblePlayerNames: string[];
    homeKnown: boolean;
    equipment: EquipmentSnapshot;
  } {
    return {
      preview: this.preview(world),
      visiblePlayerNames: this.knownPlayers(world),
      homeKnown: this.home !== null && this.home.dimension === world.dimension,
      equipment: { ...this.equipment }
    };
  }
}
