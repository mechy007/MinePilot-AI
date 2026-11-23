/**
 * Layer 6 — verified-grid route planner and bounded farm/storage workflow previews.
 * No voxel decoder or block interaction executor is shipped. Unknown space stays
 * unknown. Generated navigation and workflow steps are NEVER sent to Minecraft.
 */
import type { Vec3 } from './companion-engine.js';

export type Tile = 'unknown' | 'walkable' | 'blocked' | 'hazard';
export type RouteResult = { status: 'unverified' | 'route_found' | 'blocked' | 'invalid';
  reason: string; path: Vec3[]; expanded: number; executed: false };
export class SafeGridPlanner {
  private readonly cells = new Map<string, Tile>();
  private origin: Vec3 | null = null;
  private readonly maxCells = 1024;
  private readonly maxExpanded = 512;
  reset(): void { this.cells.clear(); this.origin = null; }
  setOrigin(origin: Vec3): void {
    if (![origin.x, origin.y, origin.z].every(Number.isInteger)) throw new RangeError('Origin must be integer');
    this.reset();
    this.origin = { ...origin };
  }
  /** Only call with a separately verified terrain decoder; packet headers do not count. */
  setVerifiedCell(x: number, z: number, tile: Tile): boolean {
    if (!this.origin || !Number.isInteger(x) || !Number.isInteger(z) ||
        Math.abs(x - this.origin.x) > 15 || Math.abs(z - this.origin.z) > 15 ||
        !(['walkable', 'blocked', 'hazard'] as string[]).includes(tile)) return false;
    const key = x + ',' + z;
    if (this.cells.size >= this.maxCells && !this.cells.has(key)) return false;
    this.cells.set(key, tile);
    return true;
  }
  findRoute(start: Vec3, target: Vec3): RouteResult {
    const fail = (status: RouteResult['status'], reason: string, expanded = 0): RouteResult =>
      ({ status, reason, expanded, path: [], executed: false });
    if (!this.origin || ![start.x, start.y, start.z, target.x, target.y, target.z].every(Number.isInteger) ||
        start.y !== target.y || this.origin.y !== start.y ||
        Math.abs(start.x - this.origin.x) > 15 || Math.abs(target.x - this.origin.x) > 15 ||
        Math.abs(start.z - this.origin.z) > 15 || Math.abs(target.z - this.origin.z) > 15)
      return fail('invalid', 'outside_verified_local_grid');
    const key = (x: number, z: number) => x + ',' + z;
    const originKey = key(start.x, start.z), finish = key(target.x, target.z);
    if (this.cells.get(originKey) !== 'walkable' || this.cells.get(finish) !== 'walkable')
      return fail('unverified', 'start_or_target_not_verified_walkable');
    const frontier: { x: number; z: number; score: number }[] =
      [{ x: start.x, z: start.z, score: 0 }];
    const distance = new Map([[originKey, 0]]);
    const previous = new Map<string, string>();
    const visited = new Set<string>();
    let expanded = 0;
    while (frontier.length && expanded < this.maxExpanded) {
      frontier.sort((a, b) => a.score - b.score);
      const next = frontier.shift()!;
      const current = key(next.x, next.z);
      if (visited.has(current)) continue;
      visited.add(current);
      expanded++;
      if (current === finish) {
        const reverse: Vec3[] = [];
        let cursor: string | undefined = current;
        while (cursor) {
          const [x, z] = cursor.split(',').map(Number);
          reverse.push({ x, y: start.y, z });
          cursor = previous.get(cursor);
          if (reverse.length > 128) return fail('blocked', 'route_too_long', expanded);
        }
        return { status: 'route_found', reason: 'trusted_grid_only_not_executed',
          path: reverse.reverse(), expanded, executed: false };
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = next.x + dx, z = next.z + dz, neighbour = key(x, z);
        if (this.cells.get(neighbour) !== 'walkable' || visited.has(neighbour)) continue;
        const cost = distance.get(current)! + 1;
        if (cost >= (distance.get(neighbour) ?? Infinity)) continue;
        distance.set(neighbour, cost);
        previous.set(neighbour, current);
        const estimate = Math.abs(target.x - x) + Math.abs(target.z - z);
        frontier.push({ x, z, score: cost + estimate });
      }
    }
    return fail('blocked', expanded >= this.maxExpanded
      ? 'bounded_search_limit_reached' : 'no_verified_walkable_route', expanded);
  }
  get verifiedCells(): number { return this.cells.size; }
}
export type WorkflowKind = 'farm_preview' | 'storage_preview' | 'collect_preview';
export type WorkflowWorld = Readonly<{
  spawned: boolean; position: Vec3 | null; dimension: number | null;
  chunks: number; safetyHold: boolean;
}>;
type TaskStep = { id: string; action: 'inspect' | 'check_inventory' | 'review_terrain' | 'review_recipe';
  status: 'pending' | 'waiting_for_verification' | 'observed' };
type Workflow = { kind: WorkflowKind; createdAt: number; steps: TaskStep[];
  dimension: number; checkpoint: number };
const VALID_KIND = new Set<WorkflowKind>(['farm_preview','storage_preview','collect_preview']);
export class LayerSixWorkflow {
  readonly pathfinder = new SafeGridPlanner();
  private readonly clock: () => number;
  private task: Workflow | null = null;
  private containers = new Map<string, { slots: number; occupied: number; seenAt: number }>();
  private updates = new Map<string, number>();
  constructor(clock: () => number = Date.now) { this.clock = clock; }
  reset(): void { this.task = null; this.containers.clear(); this.updates.clear(); this.pathfinder.reset(); }
  dimensionChanged(): void { this.reset(); }
  cancel(): void { this.task = null; }
  /** Read-only external container window. Never counts a player inventory window as storage. */
  observeContainer(packet: unknown): boolean {
    if (!packet || typeof packet !== 'object') return false;
    const p = packet as { window_id?: unknown; input?: unknown };
    if (typeof p.window_id !== 'number' || !Number.isInteger(p.window_id) ||
        p.window_id <= 0 || p.window_id > 255 || !Array.isArray(p.input) || p.input.length > 108)
      return false;
    const occupied = p.input.filter(item => typeof item?.count === 'number' &&
      Number.isInteger(item.count) && item.count > 0 && item.count <= 127).length;
    const id = String(p.window_id);
    if (this.containers.size >= 8 && !this.containers.has(id))
      this.containers.delete(this.containers.keys().next().value!);
    this.containers.set(id, { slots: p.input.length, occupied, seenAt: this.clock() });
    return true;
  }
  /** Farming observation: number of received block updates, NOT crop maturity/harvest. */
  observeBlock(packet: unknown, dimension: number | null): boolean {
    if (!this.task || this.task.kind !== 'farm_preview' || this.task.dimension !== dimension ||
        !packet || typeof packet !== 'object') return false;
    const p = packet as { position?: Partial<Vec3>; layer?: unknown };
    if (p.layer !== 0 || !p.position ||
        ![p.position.x,p.position.y,p.position.z].every(x => typeof x === 'number' && Number.isInteger(x)))
      return false;
    const key = [dimension,p.position.x,p.position.y,p.position.z].join(':');
    if (this.updates.size >= 64 && !this.updates.has(key))
      this.updates.delete(this.updates.keys().next().value!);
    this.updates.set(key,this.clock());
    return true;
  }
  plan(kind: unknown, world: WorkflowWorld): { status: 'accepted' | 'rejected'; reason: string } {
    if (!VALID_KIND.has(kind as WorkflowKind))
      return { status: 'rejected', reason: 'unknown_workflow' };
    if (world.safetyHold) return { status: 'rejected', reason: 'survival_hold' };
    if (!world.spawned || !world.position || world.chunks < 1 ||
        !Number.isInteger(world.dimension) || (world.dimension ?? -1) < 0 || (world.dimension ?? 10) > 2)
      return { status: 'rejected', reason: 'world_not_ready' };
    const steps: TaskStep[] = [
      { id: 'observe', action: 'inspect', status: 'pending' },
      { id: 'inventory', action: 'check_inventory', status: 'pending' },
      { id: 'terrain', action: 'review_terrain', status: 'pending' }
    ];
    if (kind === 'farm_preview') steps.push({ id: 'recipe', action: 'review_recipe', status: 'pending' });
    this.task = { kind: kind as WorkflowKind, createdAt: this.clock(),
      checkpoint: 0, dimension: world.dimension!, steps };
    this.updates.clear();
    return { status: 'accepted', reason: 'workflow_preview_only' };
  }
  /**
   * The sole progression gate. Reviewer can acknowledge an observational step
   * but the workflow remains waiting for an external verified executor.
   */
  reviewCheckpoint(id: unknown, world: WorkflowWorld): { status: string; reason: string } {
    if (!this.task) return { status: 'rejected', reason: 'no_workflow' };
    if (world.safetyHold) return { status: 'rejected', reason: 'survival_hold' };
    if (world.dimension !== this.task.dimension) return { status: 'rejected', reason: 'world_changed' };
    const step = this.task.steps[this.task.checkpoint];
    if (!step || id !== step.id) return { status: 'rejected', reason: 'invalid_checkpoint' };
    if (step.action === 'review_terrain') {
      step.status = 'waiting_for_verification';
      return { status: 'blocked', reason: 'voxel_decoder_and_action_executor_required' };
    }
    if (step.action === 'review_recipe') {
      step.status = 'waiting_for_verification';
      return { status: 'blocked', reason: 'recipe_executor_required' };
    }
    step.status = 'observed';
    this.task.checkpoint++;
    return { status: 'ok', reason: 'reviewed_observation_only' };
  }
  snapshot(world: WorkflowWorld) {
    const task = this.task;
    const ageLimit = this.clock() - 15000;
    const recent = Array.from(this.containers.values()).filter(c => c.seenAt >= ageLimit && c.seenAt <= this.clock());
    return {
      kind: task?.kind ?? 'none',
      state: !task ? 'idle' : world.safetyHold ? 'paused_by_safety'
        : world.dimension !== task.dimension ? 'invalid_world'
        : 'waiting_for_verification',
      checkpoint: task?.checkpoint ?? 0,
      totalSteps: task?.steps.length ?? 0,
      nextStep: task?.steps[task.checkpoint]?.action ?? null,
      steps: task?.steps.map(step => ({ ...step })) ?? [],
      containersObserved: recent.length,
      containerSlots: recent.reduce((n,c) => n+c.slots, 0),
      containerOccupied: recent.reduce((n,c) => n+c.occupied, 0),
      recentBlockUpdates: Array.from(this.updates.values()).filter(t=>t>=ageLimit).length,
      verifiedWalkableTiles: this.pathfinder.verifiedCells,
      routeExecutable: false as const,
      executed: false as const
    };
  }
}
