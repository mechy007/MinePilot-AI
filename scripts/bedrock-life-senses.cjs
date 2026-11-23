'use strict';

/**
 * Bounded, read-only perception and survival intent for a real Bedrock client.
 * This is NOT a renderer or a gameplay executor. All conclusions are based
 * exclusively on observed packets and verified voxel classifications.
 */
const MAX_ENTITIES = 128;
const STALE_MS = 15000;
const MAX_DISTANCE = 24;
const HOSTILES = /^(?:minecraft:)?(?:zombie|husk|drowned|skeleton|stray|bogged|creeper|spider|cave_spider|enderman|witch|pillager|vindicator|ravager|phantom|slime|magma_cube|blaze|ghast|piglin_brute|wither_skeleton|warden)$/;

function safePosition(value) {
  if (!value || !['x','y','z'].every(k=>Number.isFinite(value[k]) && Math.abs(value[k])<=30000000))
    return null;
  return {x:value.x,y:value.y,z:value.z};
}
function entityId(packet) {
  const value=packet?.runtime_entity_id??packet?.runtime_id??packet?.entity_id_self;
  if (typeof value !== 'bigint' && typeof value !== 'string' && typeof value !== 'number')return null;
  const id=String(value);
  return /^\d{1,20}$/.test(id)?id:null;
}
class BedrockLifeSenses {
  constructor(options={}) {
    this.clock=options.clock??Date.now;
    this.entities=new Map();
    this.health=null;
    this.hunger=null;
    this.air=null;
    this.died=false;
    this.dimension=null;
    this.recentDecisions=0;
  }
  reset(dimension=null) {
    this.entities.clear();
    this.health=null;
    this.hunger=null;
    this.air=null;
    this.died=false;
    this.dimension=dimension;
    this.recentDecisions=0;
  }
  observeVitals(values={}) {
    for (const key of ['health','hunger','air']) {
      if (Number.isFinite(values[key]) && values[key]>=0 && values[key]<=10000)
        this[key]=values[key];
    }
    if (this.health===0)this.died=true;
    else if (this.health>0)this.died=false;
  }
  observeEntity(packet, kind='mob') {
    const id=entityId(packet);
    const position=safePosition(packet?.position);
    if (!id || !position)return false;
    const raw=packet?.entity_type??packet?.type??packet?.identifier;
    if (typeof raw!=='string' || !/^(?:minecraft:)?[a-z0-9_]{1,64}$/.test(raw))
      return false; // Unknown numeric identifiers are not guessed to be hostiles.
    const name=raw.startsWith('minecraft:')?raw:'minecraft:'+raw;
    const previous=this.entities.get(id);
    if (!previous && this.entities.size>=MAX_ENTITIES) {
      this.prune();
      if (this.entities.size>=MAX_ENTITIES) return false;
    }
    this.entities.set(id,{name,kind,position,seenAt:this.clock()});
    return true;
  }
  observePlayer(id,position) {
    const point=safePosition(position);
    if (!id || !point)return false;
    const key=String(id);
    if (!this.entities.has(key) && this.entities.size>=MAX_ENTITIES) {
      this.prune();if(this.entities.size>=MAX_ENTITIES)return false;
    }
    this.entities.set(key,{name:'minecraft:player',kind:'player',position:point,seenAt:this.clock()});
    return true;
  }
  moveEntity(packet) {
    const id=entityId(packet);
    const position=safePosition(packet?.position);
    const entity=id?this.entities.get(id):null;
    if (!entity || !position)return;
    entity.position=position;
    entity.seenAt=this.clock();
  }
  removeEntity(packet) {
    const id=String(packet?.entity_id_self??packet?.entity_id??packet?.runtime_entity_id??packet?.runtime_id??'');
    this.entities.delete(id);
  }
  prune() {
    const now=this.clock();
    for(const [id,entity] of this.entities)
      if(now-entity.seenAt>STALE_MS || now<entity.seenAt) this.entities.delete(id);
  }
  snapshot(world={}) {
    this.prune();
    const position=safePosition(world.position);
    const alive=world.spawned===true && !this.died;
    const observed=[];
    if(position && world.dimension===this.dimension) {
      for(const entity of this.entities.values()) {
        const d=Math.hypot(position.x-entity.position.x,position.y-entity.position.y,
          position.z-entity.position.z);
        if(d<=MAX_DISTANCE) observed.push({
          type:entity.name,kind:entity.kind,distance:Math.round(d*10)/10,
          position:{...entity.position},hostile:entity.kind==='mob'&&HOSTILES.test(entity.name)
        });
      }
    }
    observed.sort((a,b)=>a.distance-b.distance);
    const threat=observed.find(e=>e.hostile && e.distance<=10);
    let state='awaiting_world',intent='observe',reason='world_not_ready';
    if(world.closed){state='offline';intent='none';reason='session_closed';}
    else if(this.died || (world.respawnState && world.respawnState!=='alive')){
      state='dead';intent='respawn';reason='await_server_respawn';
    }else if(alive && (this.health!==null && this.health<=6)){
      state='critical';intent='seek_safety';reason='low_health';
    }else if(alive && threat){
      state='threatened';intent='avoid_hostile';reason='hostile_within_10_blocks';
    }else if(alive && this.hunger!==null && this.hunger<=6){
      state='hungry';intent='find_food';reason='low_hunger';
    }else if(alive){
      state='exploring_ready';intent='await_goal';reason='no_immediate_threat';
    }
    const terrain=world.terrain;
    let localTerrain={status:'unknown',walkable:0,hazard:0,blocked:0,unknown:0};
    if(position && world.dimension===this.dimension && terrain?.tile) {
      const y=Math.floor(position.y-1.62+0.01);
      for(let dx=-2;dx<=2;dx++) for(let dz=-2;dz<=2;dz++){
        const tile=terrain.tile(world.dimension,Math.floor(position.x)+dx,y,
          Math.floor(position.z)+dz);
        if(tile==='walkable')localTerrain.walkable++;
        else if(tile==='hazard')localTerrain.hazard++;
        else if(tile==='blocked')localTerrain.blocked++;
        else localTerrain.unknown++;
      }
      localTerrain.status=localTerrain.unknown?'partial':'observed';
    }
    return {state,intent,reason,health:this.health,hunger:this.hunger,air:this.air,
      nearbyEntities:observed.slice(0,24),hostilesNearby:observed.filter(x=>x.hostile).length,
      localTerrain,executed:false,visualFrames:false};
  }
}
module.exports={BedrockLifeSenses};
