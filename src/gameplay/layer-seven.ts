/**
 * Layer 7 — small offline deterministic companion adviser.
 * No model API, no private chat logs, no gameplay packet emission, no
 * automatic actions. It never mistakes a passive observation for a bot skill.
 */
import { evaluateCompanionCues } from './companion-skill-policy.js';

export type Advice = {
  status: 'disabled' | 'needs_world' | 'suggested' | 'hold';
  action: 'none' | 'wait' | 'stop' | 'inspect' | 'plan_food' | 'review_spawn' |
    'review_game_mode' | 'review_movement' | 'review_water_escape' | 'review_shelter' |
    'review_terrain' | 'review_task' | 'review_materials';
  reason: string;
  approvalRequired: boolean;
  executed: false;
};
export type AdvisorWorld = {
  spawned: boolean;
  positionKnown: boolean;
  chunks: number;
  safetyHold: boolean;
  survivalLevel: 'unknown' | 'stable' | 'caution' | 'critical';
  survivalReason: string;
  foodOptions: number;
  taskStatus: string;
  followStatus: string;
  resourceStatus: string;
  buildStatus: string;
  workflowStatus: string;
  playerGameMode?: string;
  loadingPacketsSent?: number;
  loadingErrors?: number;
  movementAuthority?: number | null;
  isNight?: boolean | null;
};
export type JournalEvent = {
  at: number;
  action: Advice['action'];
  reason: string;
};
const allowedReasons = new Set([
  'disabled_by_user','session_not_ready','critical_vitals','low_hunger_food_available',
  'task_requires_manual_review','unverified_follow_route','resource_needs_terrain',
  'build_needs_materials','workflow_pending_review','ready_for_inspection',
  'hostile_mobs_may_ignore_game_mode', 'loading_handshake_write_failed',
  'loading_handshake_not_complete','movement_authority_not_available',
  'air_supply_decreasing_no_water_map','night_shelter_advisory'
]);
export class LayerSevenAdvisor {
  private mode: 'off' | 'suggestions' = 'off';
  private readonly clock: () => number;
  private history: JournalEvent[] = [];
  private lastRecorded: string | null = null;
  constructor(clock: () => number = Date.now) { this.clock = clock; }
  reset(): void { this.mode = 'off'; this.history = []; this.lastRecorded = null; }
  setMode(value: unknown): { status: 'accepted' | 'rejected'; reason: string } {
    if (value !== 'off' && value !== 'suggestions')
      return { status: 'rejected', reason: 'unsupported_advisor_mode' };
    this.mode = value;
    this.lastRecorded = null;
    if (value === 'off') this.history = [];
    return { status: 'accepted', reason: value === 'off' ? 'advisor_disabled' : 'suggestions_only' };
  }
  private advise(world: AdvisorWorld): Advice {
    const advice = (status: Advice['status'], action: Advice['action'], reason: string): Advice =>
      ({ status, action, reason, approvalRequired: action !== 'none', executed: false });
    if (this.mode !== 'suggestions') return advice('disabled','none','disabled_by_user');
    if (world.safetyHold || world.survivalLevel === 'critical')
      return advice('hold','stop','critical_vitals');
    if (!world.spawned || !world.positionKnown || world.chunks < 1)
      return advice('needs_world','wait','session_not_ready');
    // The in-world addon examples rely on server Script API movement and block
    // access. MinePilot instead uses original, passive hints from server packets.
    const cue = evaluateCompanionCues({
      spawned: world.spawned, positionKnown: world.positionKnown,
      chunkHeaders: world.chunks, safetyHold: world.safetyHold,
      playerGameMode: world.playerGameMode,
      loadingPacketsSent: world.loadingPacketsSent,
      loadingErrors: world.loadingErrors,
      movementAuthority: world.movementAuthority,
      survivalReason: world.survivalReason,
      taskStatus: world.taskStatus,
      isNight: world.isNight,
      foodOptions: world.foodOptions,
      buildStatus: world.buildStatus,
      workflowStatus: world.workflowStatus
    });
    if (['review_game_mode','review_spawn','review_movement','review_water_escape',
      'review_shelter'].includes(cue.action))
      return advice('suggested', cue.action, cue.reason);
    if (world.survivalReason === 'low_hunger' && world.foodOptions > 0)
      return advice('suggested','plan_food','low_hunger_food_available');
    if (world.taskStatus === 'paused' || world.taskStatus === 'ready_to_replan')
      return advice('suggested','review_task','task_requires_manual_review');
    if (world.followStatus === 'route_unverified')
      return advice('suggested','review_terrain','unverified_follow_route');
    if (world.resourceStatus === 'route_unverified' ||
        world.resourceStatus === 'within_range')
      return advice('suggested','review_terrain','resource_needs_terrain');
    if (world.buildStatus === 'materials_missing')
      return advice('suggested','review_materials','build_needs_materials');
    if (world.workflowStatus === 'waiting_for_verification')
      return advice('suggested','review_task','workflow_pending_review');
    return advice('suggested','inspect','ready_for_inspection');
  }
  /** Read only; does not write journal or mutate game state. */
  snapshot(world: AdvisorWorld): { mode: 'off' | 'suggestions'; recommendation: Advice;
    journalSize: number; journal: JournalEvent[] } {
    return { mode: this.mode, recommendation: this.advise(world),
      journalSize: this.history.length, journal: this.history.map(x=>({...x})) };
  }
  /** Explicit user-triggered review appends a bounded, redacted audit event. */
  review(world: AdvisorWorld): { status: string; reason: string } {
    const advice = this.advise(world);
    if (advice.status === 'disabled') return { status: 'rejected', reason: 'advisor_disabled' };
    if (!allowedReasons.has(advice.reason)) return { status: 'rejected', reason: 'invalid_recommendation' };
    const digest = advice.action + ':' + advice.reason;
    if (digest !== this.lastRecorded) {
      const time = this.clock();
      if (!Number.isFinite(time) || time < 0) return { status: 'rejected', reason: 'invalid_clock' };
      this.history.push({ at: time, action: advice.action, reason: advice.reason });
      if (this.history.length > 32) this.history.shift();
      this.lastRecorded = digest;
    }
    return { status: 'ok', reason: advice.reason };
  }
}
