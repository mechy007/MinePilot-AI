'use strict';
const MAX_AGE_MS=30*60*1000;
class WorldKnowledgeStore {
 constructor(options={}) {
  this.clock=options.clock??Date.now;this.maxChunks=Math.max(16,Math.min(2048,options.maxChunks??512));
  this.maxSections=Math.max(32,Math.min(4096,options.maxSections??1024));
  this.maxBlockUpdates=Math.max(128,Math.min(32768,options.maxBlockUpdates??8192));
  this.maxEntities=Math.max(16,Math.min(1024,options.maxEntities??256));
  this.maxAgeMs=Math.max(10000,Math.min(24*60*60*1000,options.maxAgeMs??MAX_AGE_MS));
  this.entityFreshMs=Math.max(1000,Math.min(30000,options.entityFreshMs??5000));
  this.generation=0;this.dimension=null;this.gameVersion=null;this.position=null;this.time=null;
  this.chunks=new Map();this.sections=new Map();this.blockUpdates=new Map();this.entities=new Map();
  this.lastObservationAt=null;this.lastSpatialObservationAt=null;this.lastPrunedAt=0;this.closed=false;
 }
 reset(meta={}) {
  this.generation++;this.dimension=Number.isInteger(meta.dimension)&&meta.dimension>=0&&meta.dimension<=2?meta.dimension:null;
  this.gameVersion=typeof meta.gameVersion==='string'?meta.gameVersion:null;this.position=meta.position??null;this.time=null;
  this.chunks.clear();this.sections.clear();this.blockUpdates.clear();this.entities.clear();
  this.lastObservationAt=Number.isFinite(meta.at)?meta.at:this.clock();
  this.lastSpatialObservationAt=meta.position&&Number.isFinite(meta.at)?meta.at:null;this.closed=false;return this.snapshot();
 }
 key(d,x,y,z){return [d,x,y,z].join(':');}
 matchDimension(d){
  if(!Number.isInteger(d)||d<0||d>2)return false;
  if(this.dimension===null)this.dimension=d;
  return d===this.dimension;
 }
 touch(map,key,value,limit){map.delete(key);map.set(key,value);while(map.size>limit)map.delete(map.keys().next().value);}
 prune(now=this.clock()){
  for(const[k,v]of this.chunks)if(now-v.at>this.maxAgeMs)this.chunks.delete(k);
  for(const[k,v]of this.sections)if(now-v.at>this.maxAgeMs)this.sections.delete(k);
  for(const[k,v]of this.blockUpdates)if(now-v.at>this.maxAgeMs)this.blockUpdates.delete(k);
  for(const[k,v]of this.entities)if(now-v.seenAt>Math.min(this.maxAgeMs,120000))this.entities.delete(k);
 }
 apply(event) {
  if(this.closed||!event||typeof event.type!=='string'||!Number.isFinite(event.at))return false;
  const now=event.at;
  if(event.type==='world.session.started'||event.type==='world.dimension.changed'){
   this.reset({dimension:event.dimension,gameVersion:event.gameVersion??this.gameVersion,
    position:event.type==='world.dimension.changed'?(event.position??null):(event.position??this.position),at:now});return true;}
  this.lastObservationAt=now;
  const markSpatial=()=>{this.lastSpatialObservationAt=now;};
  switch(event.type){
  case 'world.chunk.observed':{
   if(!this.matchDimension(event.dimension))return false;
   markSpatial();
   this.touch(this.chunks,this.key(event.dimension,event.x,0,event.z),{dimension:event.dimension,x:event.x,z:event.z,
    subChunkCount:event.subChunkCount,cacheEnabled:event.cacheEnabled,payloadBytes:event.payloadBytes,at:now},this.maxChunks);break;}
  case 'world.subchunks.observed':{
   if(!this.matchDimension(event.dimension))return false;
   markSpatial();
   for(const s of(event.sections??[]).slice(0,48)){
    if(![s.x,s.y,s.z].every(Number.isInteger))continue;
    this.touch(this.sections,this.key(event.dimension,s.x,s.y,s.z),{dimension:event.dimension,...s,at:now},this.maxSections);
   }break;}
  case 'world.block.updated':{
   if(!this.matchDimension(event.dimension))return false;const p=event.position;
   if(!p||![p.x,p.y,p.z,event.runtimeId].every(Number.isFinite))return false;
   markSpatial();
   this.touch(this.blockUpdates,this.key(event.dimension,Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)),
    {dimension:event.dimension,position:p,runtimeId:event.runtimeId,layer:event.layer,at:now},this.maxBlockUpdates);break;}
  case 'world.entity.added':case 'world.entity.moved':{
   if(event.dimension!==null&&event.dimension!==undefined&&!this.matchDimension(event.dimension))return false;
   const id=String(event.entityId??'');if(!/^[0-9]{1,20}$/.test(id)||!event.position)return false;
   const old=this.entities.get(id);
   markSpatial();
   this.touch(this.entities,id,{entityId:id,entityType:event.entityType??old?.entityType??'entity',
    identifier:event.identifier??old?.identifier??null,self:event.self===true||old?.self===true,
    dimension:event.dimension??old?.dimension??this.dimension,position:event.position,seenAt:now},this.maxEntities);
   if(event.self===true)this.position=event.position;break;}
  case 'world.entity.removed':if(event.entityId!=null){this.entities.delete(String(event.entityId));markSpatial();}break;
  case 'world.time.observed':this.time={time:event.time,daylightCycle:event.daylightCycle,at:now};break;
  case 'inventory.snapshot.observed':case 'inventory.snapshot.unavailable':break;
  default:return false;
  }
  if(now-this.lastPrunedAt>=10000){this.prune(now);this.lastPrunedAt=now;}return true;
 }
 getChunk(d,x,z){const v=this.chunks.get(this.key(d,x,0,z));return v?{...v}:null;}
 getSection(d,x,y,z){const v=this.sections.get(this.key(d,x,y,z));return v?{...v}:null;}
 getBlockUpdate(d,x,y,z){const v=this.blockUpdates.get(this.key(d,x,y,z));return v?{...v}:null;}
 getEntityPosition(id,dimension=this.dimension,maxAgeMs=this.entityFreshMs){
  const v=this.entities.get(String(id)),now=this.clock();
  if(!v||v.dimension!==dimension||!Number.isFinite(v.seenAt)||now-v.seenAt<0||now-v.seenAt>maxAgeMs)return null;
  return {x:v.position.x,y:v.position.y,z:v.position.z};
 }
 nearestEntities(position,options={}) {
  this.prune();if(!position||!['x','y','z'].every(k=>Number.isFinite(position[k])))return [];
  const radius=Number.isFinite(options.radius)?Math.max(0,Math.min(256,options.radius)):32;
  const types=Array.isArray(options.types)?new Set(options.types.slice(0,8)):null;
  const now=this.clock();
  return [...this.entities.values()].filter(e=>(!types||types.has(e.entityType))&&e.dimension===(options.dimension??this.dimension)&&
    Number.isFinite(e.seenAt)&&now>=e.seenAt&&now-e.seenAt<=this.entityFreshMs)
   .map(e=>({...e,ageMs:now-e.seenAt,distance:Math.hypot(e.position.x-position.x,e.position.y-position.y,e.position.z-position.z)}))
   .filter(e=>e.distance<=radius).sort((a,b)=>a.distance-b.distance).slice(0,Math.max(1,Math.min(64,options.limit??16)));
 }
 snapshot(){this.prune();return {generation:this.generation,dimension:this.dimension,gameVersion:this.gameVersion,
  position:this.position?{...this.position}:null,time:this.time?{...this.time}:null,chunks:this.chunks.size,
  observedSections:this.sections.size,blockUpdates:this.blockUpdates.size,entities:this.entities.size,
  lastObservationAt:this.lastObservationAt,lastSpatialObservationAt:this.lastSpatialObservationAt,bounded:true,persistent:false,closed:this.closed};}
 close(){this.closed=true;this.chunks.clear();this.sections.clear();this.blockUpdates.clear();this.entities.clear();this.position=null;this.time=null;this.lastObservationAt=null;this.lastSpatialObservationAt=null;}
}
module.exports={WorldKnowledgeStore};
