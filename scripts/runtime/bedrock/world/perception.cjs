'use strict';
function createWorldPerception(store,options={}) {
 const clock=options.clock??Date.now, maxAgeMs=Math.max(250,Math.min(30000,options.maxAgeMs??5000));
 return {
  nearbyEntities(position,query={}) {
   if(!store||typeof store.nearestEntities!=='function')return {status:'unavailable',entities:[],reason:'world_knowledge_store_unavailable'};
   const entities=store.nearestEntities(position,{...query,limit:Math.min(32,query.limit??16)});
   return {status:'ok',entities:entities.map(e=>({...e,ageMs:Math.max(0,clock()-e.seenAt)})),observedOnly:true};
  },
  blockObservation(dimension,x,y,z) {
   const v=store?.getBlockUpdate?.(dimension,x,y,z);if(!v)return {status:'unknown',reason:'block_not_observed'};
   const ageMs=clock()-v.at;if(ageMs<0||ageMs>maxAgeMs)return {status:'stale',ageMs,reason:'block_observation_expired'};
   return {status:'observed',runtimeId:v.runtimeId,ageMs,serverObserved:true};
  },
  freshness(){const s=store?.snapshot?.();const ageMs=s?.lastObservationAt==null?null:clock()-s.lastObservationAt;
   return {fresh:ageMs!==null&&ageMs>=0&&ageMs<=maxAgeMs,ageMs,maxAgeMs};}
 };
}
module.exports={createWorldPerception};
