/**
 * Layer 5: original shelter and crafting bill-of-materials planner.
 * No crafting, placement, break, inventory transaction or movement packets.
 * The blueprint is a proposal; block collision/ownership/terrain is NOT known.
 */
import type { Vec3 } from './companion-engine.js';
import type { SanitizedItems } from './layer-four.js';

export type BuilderWorld = Readonly<{
  position: Vec3 | null; dimension: number | null; spawned: boolean;
  chunks: number; safetyHold: boolean;
}>;
type BuildStep = Readonly<{ x: number; y: number; z: number; block: string }>;
type ShelterPlan = Readonly<{
  kind: 'shelter'; material: string; dimension: number; anchor: Vec3; steps: BuildStep[];
  createdAt: number;
}>;
type CraftPlan = Readonly<{
  kind: 'craft_planks'; material: string; requested: number; createdAt: number;
}>;
export type BuildPlan = ShelterPlan | CraftPlan;
export type BuildPreview = Readonly<{
  kind: 'none' | 'shelter' | 'craft_planks';
  state: 'idle' | 'paused_by_safety' | 'requires_inventory' |
    'materials_missing' | 'materials_available_unverified' | 'recipe_unverified' |
    'waiting_for_terrain_verification';
  reason: string;
  material: string | null;
  required: number; onHand: number | null; missing: number | null;
  suggestedLogs: number | null; logsOnHand: number | null;
  blockCount: number; observedNearbyBlockUpdates: number;
  previewSteps: BuildStep[];
  executed: false;
}>;
const WOOD = [
  'oak','spruce','birch','jungle','acacia','dark_oak',
  'mangrove','cherry','bamboo','crimson','warped','pale_oak'
] as const;
const MATERIALS = new Set(WOOD.map(name => 'minecraft:' + name + '_planks'));
const MAP_LOGS: Readonly<Record<string, string>> = Object.fromEntries(WOOD.map(name => [
  'minecraft:' + name + '_planks',
  'minecraft:' + (name === 'bamboo' ? 'bamboo_block' :
    (name === 'crimson' ? 'crimson_stem' : name === 'warped' ? 'warped_stem' : name + '_log'))
]));
const finitePosition = (p: unknown): p is Vec3 => {
  if (p === null || typeof p !== 'object') return false;
  const v = p as Partial<Vec3>;
  return [v.x, v.y, v.z].every(n => typeof n === 'number' && Number.isFinite(n) &&
    Math.abs(n) < 30000000);
};
const validDimension = (d: unknown): d is number =>
  Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 2;
const validCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 256;

/** 3x3 exterior, 2-block-high walls, south-facing 2-block door, solid 3x3 roof. */
export function simpleShelter(origin: Vec3, material: string): BuildStep[] {
  if (!finitePosition(origin) || !MATERIALS.has(material)) throw new RangeError('Invalid shelter definition');
  const x0 = Math.floor(origin.x);
  const y0 = Math.floor(origin.y);
  const z0 = Math.floor(origin.z);
  const steps: BuildStep[] = [];
  for (const dy of [0, 1]) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (Math.abs(dx) !== 1 && Math.abs(dz) !== 1) continue;
        if (dx === 0 && dz === 1) continue; // a two-block doorway
        steps.push({ x: x0 + dx, y: y0 + dy, z: z0 + dz, block: material });
      }
    }
  }
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++)
      steps.push({ x: x0 + dx, y: y0 + 2, z: z0 + dz, block: material });
  return steps;
}

export class LayerFivePlanner {
  private readonly clock: () => number;
  private plan: BuildPlan | null = null;
  private inventory: SanitizedItems = { known: false, observedAt: null, counts: {} };
  private observedUpdates = new Set<string>();

  constructor(clock: () => number = Date.now) { this.clock = clock; }

  reset(): void {
    this.plan = null;
    this.inventory = { known: false, observedAt: null, counts: {} };
    this.observedUpdates.clear();
  }
  dimensionChanged(): void {
    this.plan = null;
    this.inventory = { known: false, observedAt: null, counts: {} };
    this.observedUpdates.clear();
  }
  cancel(): void { this.plan = null; this.observedUpdates.clear(); }

  observeInventory(items: SanitizedItems): void {
    if (!items?.known || !items.counts || typeof items.counts !== 'object') {
      this.inventory = { known: false, observedAt: null, counts: {} };
      return;
    }
    const counts: Record<string, number> = {};
    for (const [key, count] of Object.entries(items.counts).slice(0, 128)) {
      if (MATERIALS.has(key) || Object.values(MAP_LOGS).includes(key)) {
        if (typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= 16256)
          counts[key] = count;
      }
    }
    this.inventory = { known: true,
      observedAt: typeof items.observedAt === 'number' && Number.isFinite(items.observedAt)
        ? items.observedAt : null, counts };
  }

  planShelter(material: unknown, world: BuilderWorld): { status: string; reason: string } {
    if (typeof material !== 'string' || !MATERIALS.has(material))
      return { status: 'rejected', reason: 'unsupported_material' };
    if (world.safetyHold) return { status: 'rejected', reason: 'survival_hold' };
    if (!world.spawned || !finitePosition(world.position) || !validDimension(world.dimension) || world.chunks < 1)
      return { status: 'rejected', reason: 'world_not_ready' };
    // IMPORTANT: this anchor is only a proposal. Unknown terrain, permissions,
    // water/lava, occupied blocks and protected structures MUST be verified later.
    const steps = simpleShelter(world.position, material);
    this.plan = { kind: 'shelter', material, dimension: world.dimension,
      anchor: { ...world.position }, steps, createdAt: this.clock() };
    this.observedUpdates.clear();
    return { status: 'accepted', reason: 'shelter_blueprint_only' };
  }

  planCraftPlanks(material: unknown, requested: unknown, world: BuilderWorld): { status: string; reason: string } {
    if (typeof material !== 'string' || !MATERIALS.has(material))
      return { status: 'rejected', reason: 'unsupported_material' };
    if (!validCount(requested)) return { status: 'rejected', reason: 'invalid_count' };
    if (world.safetyHold) return { status: 'rejected', reason: 'survival_hold' };
    if (!world.spawned || !finitePosition(world.position) || !validDimension(world.dimension))
      return { status: 'rejected', reason: 'world_not_ready' };
    this.plan = { kind: 'craft_planks', material, requested, createdAt: this.clock() };
    this.observedUpdates.clear();
    return { status: 'accepted', reason: 'crafting_recipe_estimate_only' };
  }

  /** Records proximity only. A server block update does NOT prove our bot placed it. */
  observeBlockUpdate(packet: unknown, dimension: unknown): boolean {
    if (!this.plan || this.plan.kind !== 'shelter' || this.plan.dimension !== dimension ||
      !packet || typeof packet !== 'object') return false;
    const p = packet as { position?: unknown; layer?: unknown };
    if (!finitePosition(p.position) || p.layer !== 0) return false;
    if (![p.position.x, p.position.y, p.position.z].every(Number.isInteger)) return false;
    const included = this.plan.steps.some(s => s.x === p.position!.x && s.y === p.position!.y &&
      s.z === p.position!.z);
    if (!included) return false;
    if (this.observedUpdates.size < 23)
      this.observedUpdates.add(p.position.x + ':' + p.position.y + ':' + p.position.z);
    return true;
  }

  snapshot(world: BuilderWorld): BuildPreview {
    const plan = this.plan;
    if (!plan) return { kind: 'none', state: 'idle', reason: 'no_build_plan', material: null,
      required: 0, onHand: null, missing: null, suggestedLogs: null, logsOnHand: null,
      blockCount: 0, observedNearbyBlockUpdates: 0, previewSteps: [], executed: false };
    const required = plan.kind === 'shelter' ? plan.steps.length : plan.requested;
    const known = this.inventory.known;
    const onHand = known ? (this.inventory.counts[plan.material] ?? 0) : null;
    const missing = onHand == null ? null : Math.max(0, required - onHand);
    const logName = MAP_LOGS[plan.material];
    const logsOnHand = known && logName ? (this.inventory.counts[logName] ?? 0) : null;
    // Recipe is advisory (normal four-plank conversion), not server-verified.
    const suggestedLogs = missing == null ? null : Math.ceil(missing / 4);
    const base = {
      kind: plan.kind, material: plan.material, required, onHand, missing,
      suggestedLogs, logsOnHand, blockCount: plan.kind === 'shelter' ? plan.steps.length : 0,
      observedNearbyBlockUpdates: this.observedUpdates.size,
      previewSteps: plan.kind === 'shelter' ? plan.steps.slice(0, 4).map(s => ({ ...s })) : [],
      executed: false as const
    };
    if (world.safetyHold) return { ...base, state: 'paused_by_safety', reason: 'survival_interruption' };
    if (plan.kind === 'shelter' && (plan.dimension !== world.dimension || !world.spawned || !world.position))
      return { ...base, state: 'paused_by_safety', reason: 'world_changed' };
    if (!known) return { ...base, state: 'requires_inventory', reason: 'server_inventory_not_observed' };
    if (missing != null && missing > 0) return { ...base, state: 'materials_missing',
      reason: 'materials_insufficient_no_craft_executed' };
    if (plan.kind === 'craft_planks') return { ...base,
      state: 'recipe_unverified', reason: 'server_crafting_recipe_not_validated' };
    return { ...base, state: 'waiting_for_terrain_verification',
      reason: 'no_decoded_voxels_or_block_placement' };
  }
}
