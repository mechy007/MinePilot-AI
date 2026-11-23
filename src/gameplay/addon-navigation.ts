/**
 * Navigation arbitration adapted for MinePilot's external Bedrock client.
 *
 * Source references supplied by user:
 *   Ai-multiplayer-1.9-release.mcaddon: bp/scripts/ai_navigation.js,
 *     ai_player_physics.js, ai_goals.js, ai_water_escape.js
 *   AI-Player-Plus-v3.0.mcaddon: AI_Player_Plus_BP/scripts/main.js
 *
 * The original add-ons drive world-owned custom entities with
 * @minecraft/server. This module instead arbitrates intentions strictly from
 * server observations. It NEVER calls that server API or sends gameplay
 * packets. An eventual collision-aware, host-confirmed player-input executor
 * must explicitly consume its intents.
 */
import type { Vec3 } from './companion-engine.js';

export type MotionSource =
  'survival' | 'combat' | 'water' | 'job' | 'follow' |
  'shallow_water' | 'wander' | 'manual';
export type MotionKind = 'walk' | 'sprint' | 'face' | 'hold';
export const MOTION_PRIORITY: Readonly<Record<MotionSource, number>> = {
  survival: 60, combat: 50, water: 45, job: 40,
  follow: 30, shallow_water: 22, wander: 10, manual: 70
};
export type MotionIntent = Readonly<{
  source: MotionSource;
  kind: MotionKind;
  target: Vec3;
  priority: number;
  issuedAt: number;
  expiresAt: number;
}>;
export type NavigatorObservation = Readonly<{
  position: Vec3 | null;
  dimension: number | null;
  observedAt: number;
  collisionVerified: boolean;
  nearbyVerifiedWalkable?: ReadonlyArray<Vec3>;
  safetyHold?: boolean;
}>;
export type NavigatorResult = Readonly<{
  owner: MotionSource | null;
  intent: MotionIntent | null;
  waypoint: Vec3 | null;
  state: 'idle' | 'awaiting_server' | 'ready_for_verified_executor' |
    'blocked_by_safety' | 'stuck_requires_verified_terrain';
  stuckSamples: number;
  progressMeters: number;
  reason: string;
  executed: false;
}>;

function validPoint(p: unknown): p is Vec3 {
  if (!p || typeof p !== 'object') return false;
  const candidate = p as Partial<Vec3>;
  return [candidate.x,candidate.y,candidate.z].every(x =>
    typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 3e7);
}
function planar(a: Vec3,b: Vec3): number {
  return Math.hypot(a.x-b.x,a.z-b.z);
}
function isSamePoint(a: Vec3,b: Vec3): boolean {
  return Math.abs(a.x-b.x)<0.02 && Math.abs(a.y-b.y)<0.02 && Math.abs(a.z-b.z)<0.02;
}
const allowedSources: ReadonlySet<string> =
  new Set<MotionSource>(Object.keys(MOTION_PRIORITY) as MotionSource[]);
const allowedKinds: ReadonlySet<string> =
  new Set<MotionKind>(['walk','sprint','face','hold']);

/**
 * Per-single-player navigation owner: competing job / water / follow / combat
 * intentions never simultaneously drive the bot. Intent expiry is mandatory.
 *
 * Stuck tracking follows the addon navigation's 0.12-block observation
 * threshold and 25-tick diagnostic threshold. It does NOT manufacture
 * detours across undecoded chunks.
 */
export class BedrockMotionArbiter {
  private readonly active = new Map<MotionSource, MotionIntent>();
  private readonly clock: () => number;
  private lastObserved: Vec3 | null = null;
  private lastOwner: MotionSource | null = null;
  private lastDimension: number | null = null;
  private stuck = 0;
  private progress = 0;
  private lastSampleAt: number | null = null;
  private lastResult: NavigatorResult | null = null;
  constructor(clock: () => number = Date.now) { this.clock=clock; }
  reset(): void {
    this.active.clear();
    this.lastObserved=null;
    this.lastOwner=null;
    this.lastDimension=null;
    this.stuck=0;
    this.progress=0;
    this.lastSampleAt=null;
    this.lastResult=null;
  }
  request(source: unknown,kind: unknown,target: unknown,ttlMs: unknown=1000):
      {accepted: boolean;reason: string} {
    if (typeof source!=='string' || !allowedSources.has(source) ||
        typeof kind!=='string' || !allowedKinds.has(kind) ||
        !validPoint(target) || !Number.isInteger(ttlMs) ||
        typeof ttlMs!=='number' || ttlMs<100 || ttlMs>5000)
      return {accepted:false,reason:'invalid_navigation_intent'};
    const now=this.clock();
    if (!Number.isFinite(now) || now<0)
      return {accepted:false,reason:'invalid_clock'};
    const typedSource=source as MotionSource;
    const typedKind=kind as MotionKind;
    this.active.set(typedSource,{
      source:typedSource,kind:typedKind,target:{...target},
      priority:MOTION_PRIORITY[typedSource],issuedAt:now,expiresAt:now+ttlMs
    });
    return {accepted:true,reason:'intent_registered_not_executed'};
  }
  release(source: MotionSource): void {
    this.active.delete(source);
    if (this.lastOwner===source) {
      this.lastOwner=null;
      this.stuck=0;
      this.progress=0;
      this.lastObserved=null;
    }
  }
  emergencyStop(): void { this.reset(); }
  private winning(now: number): MotionIntent | null {
    for(const [source,intent] of this.active) {
      if (intent.expiresAt<=now) this.active.delete(source);
    }
    let winner: MotionIntent|null=null;
    for(const intent of this.active.values()) {
      if(!winner || intent.priority>winner.priority ||
         (intent.priority===winner.priority && intent.issuedAt>winner.issuedAt))
        winner=intent;
    }
    return winner;
  }
  update(world: NavigatorObservation): NavigatorResult {
    const now=this.clock();
    const result=(intent:MotionIntent|null,
       state:NavigatorResult['state'],reason:string,
       waypoint:Vec3|null=null):NavigatorResult=>({
      owner:intent?.source??null,intent,waypoint,
      state,reason,stuckSamples:this.stuck,progressMeters:
        Math.round(this.progress*1000)/1000,executed:false
    });
    if (world.safetyHold) {
      this.emergencyStop();
      return this.lastResult=result(null,'blocked_by_safety','survival_safety_override');
    }
    if (!Number.isFinite(now) || now<0) {
      this.reset();
      return this.lastResult=result(null,'idle','invalid_clock');
    }
    if (world.dimension!==this.lastDimension) {
      this.lastDimension=world.dimension;
      this.lastObserved=null;
      this.lastSampleAt=null;
      this.stuck=0;
      this.progress=0;
    }
    const winner=this.winning(now);
    if (!winner) {
      this.lastOwner=null;
      this.lastObserved=null;
      this.stuck=0;
      this.progress=0;
      return this.lastResult=result(null,'idle','no_live_intent');
    }
    if (winner.source!==this.lastOwner) {
      this.lastOwner=winner.source;
      this.lastObserved=null;
      this.lastSampleAt=null;
      this.stuck=0;
      this.progress=0;
    }
    if (!validPoint(world.position) || !Number.isFinite(world.observedAt) ||
        world.observedAt>now || now-world.observedAt>30000)
      return this.lastResult=result(winner,'awaiting_server','server_position_not_recent');
    // Only count progress when an actual NEW server position sample arrives.
    if(this.lastSampleAt!==world.observedAt) {
      if(this.lastObserved) {
        const distance=planar(world.position,this.lastObserved);
        this.progress+=distance;
        this.stuck=distance<0.12?this.stuck+1:0;
      }
      this.lastObserved={...world.position};
      this.lastSampleAt=world.observedAt;
    }
    if (winner.kind==='hold' || winner.kind==='face')
      return this.lastResult=result(winner,'ready_for_verified_executor','orientation_only');
    if (!world.collisionVerified)
      return this.lastResult=result(winner,'awaiting_server','no_verified_collision_map');
    if(this.stuck>=25) {
      // Candidate detour uses ONLY verified walkable cells, never a guessed path.
      const candidates=(world.nearbyVerifiedWalkable??[])
        .filter(validPoint)
        .filter(p=>Math.abs(p.y-world.position!.y)<1.1 &&
                   planar(p,world.position!)>=1 && planar(p,world.position!)<=6);
      if(candidates.length===0)
        return this.lastResult=result(winner,'stuck_requires_verified_terrain',
          'stuck_without_verified_detour');
      const chosen=candidates.sort((a,b)=>
        planar(a,winner.target)-planar(b,winner.target))[0];
      if (isSamePoint(chosen,world.position))
        return this.lastResult=result(winner,'stuck_requires_verified_terrain',
          'no_safe_waypoint');
      return this.lastResult=result(winner,'ready_for_verified_executor',
        'verified_detour_proposal',chosen);
    }
    return this.lastResult=result(winner,'ready_for_verified_executor',
      'verified_terrain_required_to_execute',winner.target);
  }
  snapshot(): NavigatorResult {
    return this.lastResult??{
      owner:null,intent:null,waypoint:null,state:'idle',
      stuckSamples:0,progressMeters:0,reason:'no_live_intent',executed:false
    };
  }
}
