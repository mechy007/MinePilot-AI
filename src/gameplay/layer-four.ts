/**
 * Layer 4 vertical slice: survival priorities and reversible task pauses.
 * Observations only. No eating, attacking, retreating, mining or packet writes.
 */
export type SurvivalVitals = { health?: number; maxHealth?: number; hunger?: number; air?: number };
export type SanitizedItems = {
  known: boolean; observedAt: number | null; counts: Record<string, number>;
};
export type SurvivalLevel = 'unknown' | 'stable' | 'caution' | 'critical';
export type SurvivalSnapshot = {
  level: SurvivalLevel;
  reason: string;
  taskStatus: 'none' | 'running' | 'paused' | 'ready_to_replan';
  pausedGoal: string | null;
  foodPlan: { item: string; status: 'planned_not_executed' } | null;
  foodOptions: { item: string; count: number }[];
  timeOfDay: number | null;
  isNight: boolean | null;
  observedAt: number | null;
  executed: false;
};
const FOOD_IDS = new Set([
  'minecraft:apple', 'minecraft:bread', 'minecraft:carrot', 'minecraft:potato',
  'minecraft:baked_potato', 'minecraft:beetroot', 'minecraft:cooked_beef',
  'minecraft:cooked_porkchop', 'minecraft:cooked_chicken', 'minecraft:cooked_mutton',
  'minecraft:cooked_rabbit', 'minecraft:melon_slice', 'minecraft:pumpkin_pie',
  'minecraft:golden_carrot', 'minecraft:salmon', 'minecraft:cooked_salmon',
  'minecraft:cooked_cod', 'minecraft:cod', 'minecraft:dried_kelp', 'minecraft:cookie'
]);
type FoodOption = { item: string; count: number };
const validValue = (v: unknown, max = 100): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const VALID_ITEM = /^minecraft:[a-z0-9_./-]{1,80}$/;

export class LayerFourSupervisor {
  private readonly clock: () => number;
  private vitals: SurvivalVitals = {};
  private timeOfDay: number | null = null;
  private observedAt: number | null = null;
  private inventory: SanitizedItems = { known: false, observedAt: null, counts: {} };
  private trackedGoal: string | null = null;
  private pausedGoal: string | null = null;
  private wasCritical = false;
  private readyToReplan = false;
  private foodPlan: SurvivalSnapshot['foodPlan'] = null;

  constructor(clock: () => number = Date.now) { this.clock = clock; }

  reset(): void {
    this.vitals = {};
    this.timeOfDay = null;
    this.observedAt = null;
    this.inventory = { known: false, observedAt: null, counts: {} };
    this.trackedGoal = null;
    this.pausedGoal = null;
    this.wasCritical = false;
    this.readyToReplan = false;
    this.foodPlan = null;
  }
  dimensionChanged(): void {
    this.reset();
  }

  observeVitals(raw: SurvivalVitals): { becameCritical: boolean; recovered: boolean } {
    if (!raw || typeof raw !== 'object') return { becameCritical: false, recovered: false };
    let changed = false;
    for (const field of ['health', 'maxHealth', 'hunger', 'air'] as const) {
      const value = raw[field];
      if (validValue(value)) {
        this.vitals[field] = value;
        changed = true;
      }
    }
    if (!changed) return { becameCritical: false, recovered: false };
    this.observedAt = this.clock();
    const critical = this.assessment().level === 'critical';
    const becameCritical = critical && !this.wasCritical;
    const recovered = !critical && this.wasCritical;
    if (becameCritical && this.trackedGoal) {
      this.pausedGoal = this.trackedGoal;
      this.readyToReplan = false;
    }
    if (recovered && this.pausedGoal) this.readyToReplan = true;
    this.wasCritical = critical;
    return { becameCritical, recovered };
  }

  observeTime(raw: unknown): boolean {
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 240000000) return false;
    this.timeOfDay = raw % 24000;
    return true;
  }
  observeInventory(items: SanitizedItems): void {
    if (!items || !items.known || !items.counts || typeof items.counts !== 'object') {
      this.inventory = { known: false, observedAt: null, counts: {} };
      return;
    }
    const counts: Record<string, number> = {};
    for (const [name, count] of Object.entries(items.counts).slice(0, 128)) {
      if (VALID_ITEM.test(name) && Number.isInteger(count) && count >= 0 && count <= 16256)
        counts[name] = count;
    }
    this.inventory = { known: true, observedAt:
      typeof items.observedAt === 'number' && Number.isFinite(items.observedAt) ? items.observedAt : null, counts };
  }

  setTask(label: string | null): void {
    if (label !== null && !/^[a-z_]{1,32}$/.test(label)) return;
    this.trackedGoal = label;
    if (!this.wasCritical) {
      this.pausedGoal = null;
      this.readyToReplan = false;
    }
  }
  cancel(): void {
    this.trackedGoal = null;
    this.pausedGoal = null;
    this.readyToReplan = false;
    this.foodPlan = null;
  }

  private assessment(): { level: SurvivalLevel; reason: string } {
    const { health, maxHealth, hunger, air } = this.vitals;
    if (health !== undefined && health <= 6) return { level: 'critical', reason: 'critical_health' };
    if (air !== undefined && air <= 4) return { level: 'critical', reason: 'low_air_supply' };
    if (health !== undefined && maxHealth !== undefined && maxHealth > 0 && health / maxHealth <= 0.35)
      return { level: 'critical', reason: 'low_health_ratio' };
    if (hunger !== undefined && hunger <= 7) return { level: 'caution', reason: 'low_hunger' };
    if (air !== undefined && air <= 10) return { level: 'caution', reason: 'air_supply_decreasing' };
    if (health !== undefined && maxHealth !== undefined && maxHealth > 0 && health / maxHealth < 0.6)
      return { level: 'caution', reason: 'health_decreased' };
    if (this.timeOfDay !== null && this.timeOfDay >= 13000 && this.timeOfDay <= 23000)
      return { level: 'caution', reason: 'night_advisory_only' };
    if (health === undefined && hunger === undefined && air === undefined)
      return { level: 'unknown', reason: 'server_vitals_unavailable' };
    return { level: 'stable', reason: 'observed_vitals_stable' };
  }

  get critical(): boolean { return this.assessment().level === 'critical'; }

  private foods(): FoodOption[] {
    if (!this.inventory.known) return [];
    return Object.entries(this.inventory.counts)
      .filter(([name, n]) => FOOD_IDS.has(name) && n > 0)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(0, 16).map(([item, count]) => ({ item, count }));
  }

  planFood(): { status: 'accepted' | 'rejected'; reason: string } {
    if (!this.inventory.known) return { status: 'rejected', reason: 'inventory_not_observed' };
    if (this.vitals.hunger === undefined) return { status: 'rejected', reason: 'hunger_not_observed' };
    if (this.vitals.hunger > 17) return { status: 'rejected', reason: 'not_hungry' };
    const food = this.foods()[0];
    if (!food) return { status: 'rejected', reason: 'no_verified_food_in_inventory' };
    this.foodPlan = { item: food.item, status: 'planned_not_executed' };
    return { status: 'accepted', reason: 'food_use_requires_verified_item_interaction' };
  }

  snapshot(): SurvivalSnapshot {
    const assessment = this.assessment();
    return {
      level: assessment.level,
      reason: assessment.reason,
      taskStatus: this.pausedGoal
        ? this.readyToReplan ? 'ready_to_replan' : 'paused'
        : this.trackedGoal ? 'running' : 'none',
      pausedGoal: this.pausedGoal,
      foodPlan: this.foodPlan ? { ...this.foodPlan } : null,
      foodOptions: this.foods(),
      timeOfDay: this.timeOfDay,
      isNight: this.timeOfDay == null ? null :
        this.timeOfDay >= 13000 && this.timeOfDay <= 23000,
      observedAt: this.observedAt,
      executed: false
    };
  }
}
