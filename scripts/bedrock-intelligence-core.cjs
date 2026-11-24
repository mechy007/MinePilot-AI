'use strict';

/**
 * MinePilot Intelligence Core V1 — deterministic, explainable decisions made
 * from a verified observation stream. No speculative movement or network I/O.
 * All state is session-local and bounded; no player identifiers are stored.
 */
const MAX_HISTORY = 32;
const MAX_MEMORY = 64;
const FRESH_POSITION_MS = 7000;
const HAZARD_DISTANCE = 8;
const VALID_GOALS = new Set(['standby', 'survive', 'follow', 'return_home', 'explore', 'gather']);

const candidate = (action, priority, reason, confidence, allowed, evidence) =>
  ({action,priority,reason,confidence,allowed,evidence});

class MinePilotIntelligence {
  constructor(options={}) {
    this.clock=options.clock??Date.now;
    this.reset(null);
  }
  reset(dimension=null) {
    this.dimension=dimension;
    this.goal='standby';
    this.revision=0;
    this.history=[];
    this.cells=new Map();
    this.last=null;
    this.lastStopKey=null;
    this.totalDecisions=0;
    this.knownOutcomes={verified:0,failed:0};
  }
  setGoal(goal) {
    if(!VALID_GOALS.has(goal))return {status:'rejected',reason:'unknown_goal'};
    this.goal=goal;
    this.revision++;
    return {status:'accepted',reason:'goal_selected',goal};
  }
  rememberPosition(position,dimension,terrainStatus='unknown') {
    if(dimension!==this.dimension || !position ||
      !['x','y','z'].every(k=>Number.isFinite(position[k])))return;
    const x=Math.floor(position.x/4),y=Math.floor(position.y/4),
      z=Math.floor(position.z/4);
    if(Math.max(Math.abs(x),Math.abs(z))>7500000)return;
    const key=[dimension,x,y,z].join(':');
    this.cells.delete(key);
    this.cells.set(key,{x,y,z,terrain:terrainStatus==='observed'?'observed':'partial'});
    while(this.cells.size>MAX_MEMORY)this.cells.delete(this.cells.keys().next().value);
  }
  noteOutcome(kind) {
    if(kind!=='verified'&&kind!=='failed')return;
    this.knownOutcomes[kind]++;
  }
  decide(observation={}) {
    const now=this.clock();
    const life=observation.life??{};
    const position=observation.position;
    const freshness=observation.positionAgeMs;
    const worldReady=observation.spawned===true &&
      Number.isInteger(observation.dimension) && position &&
      ['x','y','z'].every(k=>Number.isFinite(position[k])) &&
      Number.isFinite(freshness) && freshness>=0 && freshness<=FRESH_POSITION_MS;
    const candidates=[];
    if(!observation.spawned || observation.respawnState!=='alive' ||
       life.state==='dead') {
      candidates.push(candidate('await_respawn',100,'not_alive',1,false,['respawn_state']));
    } else if(!worldReady) {
      candidates.push(candidate('observe',90,'world_state_stale',1,false,['position_freshness']));
    } else {
      const health=life.health;
      const nearby=Array.isArray(life.nearbyEntities)?life.nearbyEntities:[];
      const threat=nearby.find(e=>e?.hostile===true &&
        Number.isFinite(e.distance) && e.distance<=HAZARD_DISTANCE);
      if(Number.isFinite(health) && health<=6) {
        candidates.push(candidate('seek_safety',95,'critical_health',1,false,['self_health']));
      }
      if(threat) {
        candidates.push(candidate('avoid_threat',85,'hostile_nearby',0.95,false,
          ['observed_hostile_distance']));
      }
      if(Number.isFinite(life.hunger)&&life.hunger<=6) {
        candidates.push(candidate('find_food',70,'low_hunger',1,false,['self_hunger']));
      }
      const knownTerrain=observation.terrainReady===true &&
        life.localTerrain?.unknown===0 &&
        life.localTerrain?.hazard===0;
      if(this.goal!=='standby') {
        const safe=knownTerrain && observation.safetyHold!==true;
        candidates.push(candidate(
          this.goal==='survive'?'survive_world':
          this.goal==='follow'?'follow_player':
          this.goal==='return_home'?'return_home':
          this.goal==='explore'?'explore':'gather_resources',
          40,safe?'goal_can_be_planned':'terrain_or_safety_unverified',
          safe?0.8:0.35,false,
          ['selected_goal',safe?'known_local_terrain':'unknown_local_terrain']));
      }
      candidates.push(candidate('observe',10,'monitor_world',1,false,['live_packet_data']));
    }
    candidates.sort((a,b)=>b.priority-a.priority);
    const selection=candidates[0];
    if(worldReady)this.rememberPosition(position,observation.dimension,
      life.localTerrain?.status??'unknown');
    const key=[selection.action,selection.reason,this.goal,observation.dimension].join(':');
    if(this.last?.key!==key) {
      this.history.push({at:now,action:selection.action,reason:selection.reason});
      if(this.history.length>MAX_HISTORY)this.history.shift();
    }
    this.totalDecisions++;
    this.last={key,at:now,selection,candidates:candidates.slice(0,4),
      worldReady:Boolean(worldReady)};
    return this.snapshot();
  }
  shouldEmergencyStop() {
    const selected=this.last?.selection;
    if(!selected || !['seek_safety','avoid_threat','await_respawn'].includes(selected.action))
      return false;
    const key=this.last.key;
    if(this.lastStopKey===key)return false;
    this.lastStopKey=key;
    return true;
  }
  snapshot() {
    return {
      goal:this.goal,priority:this.last?.selection?.priority??0,
      action:this.last?.selection?.action??'observe',
      reason:this.last?.selection?.reason??'awaiting_observation',
      confidence:this.last?.selection?.confidence??0,
      execution:'recommendation_only',
      verifiedWorld:this.last?.worldReady??false,
      candidates:this.last?.candidates?.map(x=>({
        action:x.action,priority:x.priority,reason:x.reason,
        confidence:x.confidence,allowed:x.allowed
      }))??[],
      memoryCells:this.cells.size,decisionCount:this.totalDecisions,
      outcomes:{...this.knownOutcomes},
      history:this.history.slice(-12).map(x=>({...x}))
    };
  }
}
module.exports={MinePilotIntelligence};
