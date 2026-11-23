/**
 * Layer 3 — read-only resources and gathering task receipts.
 *
 * Source of truth is the Bedrock server's item registry, spawned item entities,
 * block updates, pickup acknowledgements, and player inventory snapshots.
 * Does NOT mine, collect, teleport, write packets or infer unloaded chunk blocks.
 */
import type { Vec3 } from './companion-engine.js';

export type ResourceWorld = Readonly<{
  position: Vec3 | null; dimension: number | null; chunks: number;
  spawned: boolean; safetyHold: boolean;
}>;
export type ResourceGoal = Readonly<
  | { kind: 'collect'; itemName: string; requested: number; observed: number; startedAt: number }
  | { kind: 'inspect_block'; startedAt: number }
>;
export type ResourceRoute = Readonly<{
  status: 'idle' | 'world_unavailable' | 'paused_by_safety' | 'waiting_for_item' |
    'waiting_for_block_update' | 'route_unverified' | 'within_range' |
    'observed_inventory_increase';
  reason: string;
  itemName: string | null;
  observed: number;
  requested: number;
  target: Vec3 | null;
  distance: number | null;
  heading: number | null;
  nextPoint: Vec3 | null;
  executed: false;
}>;
type Drop = { id: string; itemId: number; count: number; position: Vec3; dimension: number; seenAt: number };
type BlockUpdate = { id: number; position: Vec3; dimension: number; seenAt: number };
type PendingPickup = { itemId: number; count: number; seenAt: number };
const MAX_REGISTRY = 8192;
const MAX_DROPS = 96;
const MAX_BLOCK_UPDATES = 256;
const DROP_TTL_MS = 15000;
const BLOCK_TTL_MS = 30000;
const RECEIPT_TTL_MS = 5000;
const ITEM_NAME = /^minecraft:[a-z0-9_./-]{1,80}$/;
const idNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 32767 ? value : null;
const entityId = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null;
  const id = String(value);
  return /^[1-9]\d{0,19}$/.test(id) ? id : null;
};
const finiteVec = (value: unknown): value is Vec3 => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<Vec3>;
  return [v.x, v.y, v.z].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 30000000);
};
const blockCoords = (value: unknown): value is Vec3 =>
  finiteVec(value) && [value.x, value.y, value.z].every(Number.isInteger);
const dimensionOkay = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 2;
const copy = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });
const snapshotRoute = (status: ResourceRoute['status'], reason: string, goal: ResourceGoal | null,
  more: Partial<Pick<ResourceRoute, 'target' | 'distance' | 'heading' | 'nextPoint'>> = {}): ResourceRoute => ({
  status, reason, itemName: goal?.kind === 'collect' ? goal.itemName : null,
  observed: goal?.kind === 'collect' ? goal.observed : 0,
  requested: goal?.kind === 'collect' ? goal.requested : 0,
  target: null, distance: null, heading: null, nextPoint: null, executed: false, ...more
});

export class LayerThreePlanner {
  private readonly clock: () => number;
  private readonly registry = new Map<number, string>();
  private readonly drops = new Map<string, Drop>();
  private readonly blockUpdates = new Map<string, BlockUpdate>();
  private readonly inventory = new Map<number, number>();
  private inventoryKnown = false;
  private pendingPickups: PendingPickup[] = [];
  private goal: ResourceGoal | null = null;
  private progressValidated = false;

  constructor(clock: () => number = Date.now) { this.clock = clock; }
  private now(): number { return this.clock(); }

  reset(): void {
    this.registry.clear();
    this.dimensionChanged();
    this.inventory.clear();
    this.inventoryKnown = false;
  }
  dimensionChanged(): void {
    this.drops.clear();
    this.blockUpdates.clear();
    this.pendingPickups = [];
    this.goal = null;
    this.progressValidated = false;
  }
  cancel(): void {
    this.goal = null;
    this.pendingPickups = [];
    this.progressValidated = false;
  }

  /** Uses only the item ID/name fields; intentionally ignores remote NBT data. */
  observeItemRegistry(packet: unknown): number {
    if (!packet || typeof packet !== 'object') return 0;
    const states = (packet as { itemstates?: unknown }).itemstates;
    if (!Array.isArray(states) || states.length > MAX_REGISTRY) return 0;
    const parsed = new Map<number, string>();
    for (const state of states) {
      const id = idNumber(state?.runtime_id);
      const name = state?.name;
      if (id != null && typeof name === 'string' && ITEM_NAME.test(name)) parsed.set(id, name);
    }
    if (!parsed.size) return 0;
    this.registry.clear();
    for (const [id, name] of parsed) this.registry.set(id, name);
    return this.registry.size;
  }

  /** A block update is just a changed runtime id, NOT proof of a block mine. */
  observeBlock(packet: unknown, dimension: unknown): boolean {
    if (!packet || typeof packet !== 'object' || !dimensionOkay(dimension)) return false;
    const p = packet as { position?: unknown; block_runtime_id?: unknown; layer?: unknown };
    if (!blockCoords(p.position) || p.layer !== 0) return false;
    const id = p.block_runtime_id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id > 0xffffffff) return false;
    const key = dimension + ':' + p.position.x + ':' + p.position.y + ':' + p.position.z;
    this.blockUpdates.delete(key);
    this.blockUpdates.set(key, { id, position: copy(p.position), dimension, seenAt: this.now() });
    if (this.blockUpdates.size > MAX_BLOCK_UPDATES)
      this.blockUpdates.delete(this.blockUpdates.keys().next().value!);
    return true;
  }

  /** Only one observed actor is indexed per runtime entity id. */
  observeDrop(packet: unknown, dimension: unknown): boolean {
    if (!packet || typeof packet !== 'object' || !dimensionOkay(dimension)) return false;
    const p = packet as {
      runtime_entity_id?: unknown; item?: { network_id?: unknown; count?: unknown }; position?: unknown
    };
    const eid = entityId(p.runtime_entity_id);
    const id = idNumber(p.item?.network_id);
    const count = p.item?.count;
    if (!eid || id == null || !finiteVec(p.position) ||
      typeof count !== 'number' || !Number.isInteger(count) || count <= 0 || count > 127) return false;
    this.drops.delete(eid);
    this.drops.set(eid, { id: eid, itemId: id, count, position: copy(p.position),
      dimension, seenAt: this.now() });
    if (this.drops.size > MAX_DROPS) this.drops.delete(this.drops.keys().next().value!);
    return true;
  }

  moveDrop(rawId: unknown, position: unknown): void {
    const id = entityId(rawId);
    const item = id && this.drops.get(id);
    if (item && finiteVec(position)) {
      item.position = copy(position);
      item.seenAt = this.now();
    }
  }
  removeEntity(rawId: unknown): void {
    const id = entityId(rawId);
    if (id) this.drops.delete(id);
  }

  /** TakeItemEntity is not the same as having gathered an item in inventory. */
  observeTake(packet: unknown, selfId: unknown): boolean {
    if (!packet || typeof packet !== 'object' || !entityId(selfId)) return false;
    const p = packet as { runtime_entity_id?: unknown; target?: unknown };
    if (entityId(p.target) !== entityId(selfId)) return false;
    const dropId = entityId(p.runtime_entity_id);
    const drop = dropId && this.drops.get(dropId);
    if (!drop) return false;
    if (this.goal?.kind === 'collect' && this.registry.get(drop.itemId) === this.goal.itemName &&
        this.inventoryKnown) {
      this.pendingPickups.push({ itemId: drop.itemId, count: drop.count, seenAt: this.now() });
      this.pendingPickups = this.pendingPickups.slice(-24);
    }
    this.drops.delete(drop.id);
    return true;
  }

  observeInventory(packet: unknown): boolean {
    if (!packet || typeof packet !== 'object') return false;
    const p = packet as { window_id?: unknown; input?: unknown };
    if (p.window_id !== 0 && p.window_id !== 'inventory') return false;
    if (!Array.isArray(p.input) || p.input.length > 128) return false;
    const totals = new Map<number, number>();
    for (const item of p.input) {
      const id = idNumber(item?.network_id);
      const count = item?.count;
      if (id != null && typeof count === 'number' && Number.isInteger(count) && count >= 1 && count <= 127)
        totals.set(id, (totals.get(id) ?? 0) + count);
    }
    if (this.inventoryKnown && this.goal?.kind === 'collect') {
      // target id is found directly from the registry; no assumed block-to-item equivalence.
      const itemId = Array.from(this.registry.entries()).find(([, name]) =>
        this.goal?.kind === 'collect' && name === this.goal.itemName)?.[0];
      if (itemId !== undefined) {
        const gain = Math.max(0, (totals.get(itemId) ?? 0) - (this.inventory.get(itemId) ?? 0));
        const now = this.now();
        const acknowledgements = this.pendingPickups.filter(p => p.itemId === itemId &&
          now - p.seenAt >= 0 && now - p.seenAt <= RECEIPT_TTL_MS);
        const available = acknowledgements.reduce((sum, p) => sum + p.count, 0);
        if (gain > 0 && available > 0) {
          const confirmed = Math.min(gain, available, this.goal.requested - this.goal.observed);
          if (confirmed > 0) {
            this.goal = { ...this.goal, observed: this.goal.observed + confirmed };
            this.progressValidated = true;
          }
          this.pendingPickups = this.pendingPickups.filter(p => p.itemId !== itemId);
        }
      }
    }
    this.inventory.clear();
    for (const [id, count] of totals) this.inventory.set(id, count);
    this.inventoryKnown = true;
    return true;
  }

  planCollect(itemName: unknown, count: unknown, world: ResourceWorld): { status: string; reason: string } {
    if (!world.spawned || !finiteVec(world.position) || !dimensionOkay(world.dimension) || world.chunks < 1)
      return { status: 'rejected', reason: 'world_not_ready' };
    if (world.safetyHold) return { status: 'rejected', reason: 'critical_health' };
    if (typeof itemName !== 'string' || !ITEM_NAME.test(itemName) ||
      !Array.from(this.registry.values()).includes(itemName))
      return { status: 'rejected', reason: 'item_not_in_registry' };
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 64)
      return { status: 'rejected', reason: 'invalid_count' };
    this.goal = { kind: 'collect', itemName, requested: count, observed: 0, startedAt: this.now() };
    this.pendingPickups = [];
    this.progressValidated = false;
    return { status: 'accepted', reason: 'collect_plan_only' };
  }

  /** Plan a target from received block update packets; no block scan or digging. */
  planInspectBlock(world: ResourceWorld): { status: string; reason: string } {
    if (!world.spawned || !finiteVec(world.position) || !dimensionOkay(world.dimension) || world.chunks < 1)
      return { status: 'rejected', reason: 'world_not_ready' };
    this.goal = { kind: 'inspect_block', startedAt: this.now() };
    this.pendingPickups = [];
    return { status: 'accepted', reason: 'block_observation_only' };
  }

  private recentDrops(world: ResourceWorld): Drop[] {
    const now = this.now();
    return Array.from(this.drops.values()).filter(d =>
      d.dimension === world.dimension && now - d.seenAt >= 0 &&
      now - d.seenAt <= DROP_TTL_MS);
  }
  private recentBlocks(world: ResourceWorld): BlockUpdate[] {
    const now = this.now();
    return Array.from(this.blockUpdates.values()).filter(b =>
      b.dimension === world.dimension && now - b.seenAt >= 0 &&
      now - b.seenAt <= BLOCK_TTL_MS);
  }

  preview(world: ResourceWorld): ResourceRoute {
    const goal = this.goal;
    if (!goal) return snapshotRoute('idle', 'no_resource_goal', goal);
    if (world.safetyHold) return snapshotRoute('paused_by_safety', 'critical_health', goal);
    if (!world.spawned || !finiteVec(world.position) || !dimensionOkay(world.dimension) || world.chunks < 1)
      return snapshotRoute('world_unavailable', 'no_live_world_position', goal);
    if (goal.kind === 'collect' && goal.observed >= goal.requested)
      return snapshotRoute('observed_inventory_increase', 'server_pickup_and_inventory_delta_observed_not_bot_action', goal);
    const options: { position: Vec3 }[] = goal.kind === 'collect'
      ? this.recentDrops(world).filter(d => this.registry.get(d.itemId) === goal.itemName)
      : this.recentBlocks(world);
    if (!options.length) return snapshotRoute(goal.kind === 'collect' ? 'waiting_for_item' : 'waiting_for_block_update',
      goal.kind === 'collect' ? 'no_matching_drop_observed' : 'no_block_updates_observed', goal);
    const origin = world.position;
    const target = options.reduce((best, candidate) =>
      Math.hypot(candidate.position.x - origin.x, candidate.position.y - origin.y,
        candidate.position.z - origin.z) <
      Math.hypot(best.position.x - origin.x, best.position.y - origin.y, best.position.z - origin.z)
        ? candidate : best).position;
    const dx = target.x - origin.x, dz = target.z - origin.z, dy = target.y - origin.y;
    const distance = Math.hypot(dx, dy, dz);
    const heading = ((Math.atan2(-dx, dz) * 180 / Math.PI) % 360 + 360) % 360;
    if (distance <= (goal.kind === 'collect' ? 1.5 : 4.0))
      return snapshotRoute('within_range', 'in_range_no_interaction_emitted', goal,
        { target: copy(target), distance: Math.round(distance * 100) / 100, heading: Math.round(heading) });
    if (Math.abs(dy) > 1.25) return snapshotRoute('route_unverified', 'vertical_path_needs_voxel_data', goal,
      { target: copy(target), distance: Math.round(distance * 100) / 100 });
    const horizontal = Math.hypot(dx, dz);
    const nextPoint = horizontal < 0.0001 ? null :
      { x: origin.x + dx / horizontal * Math.min(1, horizontal),
        y: origin.y, z: origin.z + dz / horizontal * Math.min(1, horizontal) };
    return snapshotRoute('route_unverified', 'navigation_needs_collision_data', goal, {
      target: copy(target), distance: Math.round(distance * 100) / 100,
      heading: Math.round(heading), nextPoint
    });
  }

  snapshot(world: ResourceWorld): {
    route: ResourceRoute;
    observedDrops: number;
    observedBlockUpdates: number;
    registeredItems: number;
    nearbyItemNames: string[];
    inventoryKnown: boolean;
    pickupCorrelations: boolean;
  } {
    const playerPosition = world.position;
    const names = new Set(this.recentDrops(world)
      .filter(d => playerPosition != null && finiteVec(playerPosition) &&
        Math.hypot(d.position.x - playerPosition.x, d.position.y - playerPosition.y,
          d.position.z - playerPosition.z) <= 16)
      .map(d => this.registry.get(d.itemId)).filter((name): name is string => !!name));
    return {
      route: this.preview(world), observedDrops: this.recentDrops(world).length,
      observedBlockUpdates: this.recentBlocks(world).length, registeredItems: this.registry.size,
      nearbyItemNames: Array.from(names).sort().slice(0, 12),
      inventoryKnown: this.inventoryKnown, pickupCorrelations: this.progressValidated
    };
  }
}
