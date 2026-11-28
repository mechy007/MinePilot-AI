'use strict';
const HOSTILE=new Set(['zombie','husk','drowned','skeleton','stray','bogged','creeper','spider','cave_spider','witch','pillager','vindicator','ravager','phantom','slime','magma_cube','blaze','ghast','piglin_brute','wither_skeleton','warden']);
const PASSIVE=new Set(['cow','mooshroom','sheep','pig','chicken','rabbit','horse','donkey','mule','llama','trader_llama','cat','ocelot','parrot','turtle','fox','axolotl','allay','sniffer','camel','armadillo','goat','squid','glow_squid','cod','salmon','tropical_fish','pufferfish','bat','villager']);
const NEUTRAL=new Set(['wolf','bee','enderman','piglin','polar_bear','dolphin','iron_golem']);
const identifier=value=>typeof value==='string'?value.replace(/^minecraft:/,'').toLowerCase():'';
function classifyEntity(entity){
 if(entity.entityType==='player')return 'player';
 if(entity.entityType==='item_drop')return 'item_drop';
 if(entity.entityType!=='mob')return 'unknown';
 const name=identifier(entity.identifier);
 if(HOSTILE.has(name))return 'hostile';
 if(PASSIVE.has(name))return 'passive';
 if(NEUTRAL.has(name))return 'neutral';
 return 'unknown';
}
function createWorldPerception(store,options={}){
 const clock=options.clock??Date.now,maxAgeMs=Math.max(250,Math.min(30000,options.maxAgeMs??5000));
 return {
  nearbyEntities(position,query={}){
   if(!store||typeof store.nearestEntities!=='function')return {status:'unavailable',entities:[],reason:'world_knowledge_store_unavailable'};
   if(!position||!['x','y','z'].every(k=>Number.isFinite(position[k])))return {status:'unavailable',entities:[],reason:'position_unavailable'};
   const result=store.nearestEntities(position,{...query,limit:Math.min(32,query.limit??16)});
   return {status:'ok',entities:result.map(e=>({...e,classification:classifyEntity(e),ageMs:Number.isFinite(e.ageMs)?e.ageMs:Math.max(0,clock()-e.seenAt),serverObserved:true})),observedOnly:true};
  },
  blockObservation(dimension,x,y,z){
   const v=store?.getBlockUpdate?.(dimension,x,y,z);if(!v)return {status:'unknown',reason:'block_not_observed'};
   const ageMs=clock()-v.at;if(ageMs<0||ageMs>maxAgeMs)return {status:'stale',ageMs,reason:'block_observation_expired'};
   return {status:'observed',runtimeId:v.runtimeId,ageMs,serverObserved:true};
  },
  freshness(){
   const at=store?.snapshot?.()?.lastSpatialObservationAt??null,ageMs=at==null?null:clock()-at;
   return {fresh:ageMs!==null&&ageMs>=0&&ageMs<=maxAgeMs,ageMs,maxAgeMs,lastSpatialObservationAt:at};
  },
  snapshot(input={}){
   const {position,dimension,terrain}=input,freshness=this.freshness();
   if(!position||!['x','y','z'].every(k=>Number.isFinite(position[k]))||!Number.isInteger(dimension)||dimension<0||dimension>2)
    return {status:'unavailable',reason:'world_position_or_dimension_unavailable',freshness,entities:[],terrain:{status:'unknown',sampledCells:0,walkable:0,blocked:0,hazard:0,unknown:0}};
   const radius=Math.max(1,Math.min(8,Number.isFinite(input.radius)?Math.floor(input.radius):4));
   const entities=this.nearbyEntities(position,{dimension,radius:Math.min(64,radius*4),limit:32}).entities??[];
   const terrainSummary={status:'unknown',radius,sampledCells:0,walkable:0,blocked:0,hazard:0,unknown:0,levels:{}};
   if(terrain&&typeof terrain.tile==='function'){
    const baseY=Math.floor(position.y-1.62+0.01);
    for(const offset of [0,1,-1]){
     const level={offset,walkable:0,blocked:0,hazard:0,unknown:0};
     for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius;dz<=radius;dz++){
      const x=Math.floor(position.x)+dx,z=Math.floor(position.z)+dz;
      let tile='unknown';try{tile=terrain.tile(dimension,x,baseY+offset,z);}catch{}
      if(!['walkable','blocked','hazard'].includes(tile))tile='unknown';
      level[tile]++;if(offset===0)terrainSummary[tile]++;
     }
     terrainSummary.levels[String(offset)]=level;
    }
    terrainSummary.sampledCells=(radius*2+1)**2;terrainSummary.status=terrainSummary.unknown===0?'observed':'partial';
   }
   const counts={players:0,hostiles:0,passive:0,neutral:0,drops:0,unknown:0};
   for(const e of entities){const key={player:'players',hostile:'hostiles',passive:'passive',neutral:'neutral',item_drop:'drops'}[e.classification]??'unknown';counts[key]++;}
   return {status:freshness.fresh?'observed':'stale',reason:freshness.fresh?'fresh_server_observations':'spatial_observation_stale',
    observedOnly:true,dimension,freshness,entityCount:entities.length,counts,entities,terrain:terrainSummary};
  }
 };
}
module.exports={createWorldPerception,classifyEntity};
