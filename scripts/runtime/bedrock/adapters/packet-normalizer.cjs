'use strict';
const DIMENSIONS=Object.freeze({overworld:0,nether:1,end:2});
const finiteInt=v=>Number.isSafeInteger(v);
const finiteNumber=v=>typeof v==='number'&&Number.isFinite(v);
const safeDimension=v=>{if(typeof v==='string')v=DIMENSIONS[v.toLowerCase()];return finiteInt(v)&&v>=0&&v<=2?v:null;};
const safePosition=v=>v&&typeof v==='object'&&['x','y','z'].every(k=>finiteNumber(v[k])&&Math.abs(v[k])<=30_000_000)
 ? Object.freeze({x:Math.round(v.x*1000)/1000,y:Math.round(v.y*1000)/1000,z:Math.round(v.z*1000)/1000}):null;
const runtimeId=v=>{if(typeof v==='bigint')v=v.toString();if(typeof v!=='string'&&!finiteInt(v))return null;const s=String(v);return /^[0-9]{1,20}$/.test(s)?s:null;};
function deepFreeze(value,depth=0){if(!value||typeof value!=='object'||depth>8||Object.isFrozen(value))return value;
 for(const child of Object.values(value))deepFreeze(child,depth+1);return Object.freeze(value);}
const eventPayload=(type,at,data)=>deepFreeze({type,at,...data});
function actorPosition(packet,bridge,id,dimension){
 const full=safePosition(packet?.position);if(full)return full;
 const previous=bridge?.runtimeExtensions?.world?.getEntityPosition?.(id,dimension);
 const result={...(previous??{})};let supplied=false;
 const axes=[['x',['new_position_x','newPositionX','position_x','x']],['y',['new_position_y','newPositionY','position_y','y']],['z',['new_position_z','newPositionZ','position_z','z']]];
 for(const [axis,keys] of axes)for(const key of keys){
  if(finiteNumber(packet?.[key])){result[axis]=packet[key];supplied=true;break;}
 }
 return supplied?safePosition(result):null;
}
function normalizePacket(name,packet,bridge,at=Date.now()){
 if(!packet||typeof packet!=='object'||Array.isArray(packet))return null;
 const p=packet;
 switch(name){
 case 'start_game':{
  const v=p.server_version??p.engine;
  return eventPayload('world.session.started',at,{gameVersion:typeof v==='string'?v.slice(0,32):null,
   dimension:safeDimension(p.dimension),position:safePosition(p.player_position??p.position),
   protocol:finiteInt(p.protocol_version)?p.protocol_version:null,hashedBlockIds:p.block_network_ids_are_hashes===true,
   currentTick:typeof p.current_tick==='bigint'?p.current_tick.toString():finiteInt(p.current_tick)&&p.current_tick>=0?p.current_tick:null});
 }
 case 'change_dimension':{
  const dimension=safeDimension(p.dimension??bridge?.dimension);
  if(dimension===null)return null;
  return eventPayload('world.dimension.changed',at,{dimension,position:safePosition(p.position)});
 }
 case 'level_chunk':{
  const dimension=safeDimension(p.dimension??bridge?.dimension);
  if(!finiteInt(p.x)||!finiteInt(p.z)||dimension===null||Math.abs(p.x)>1_875_000||Math.abs(p.z)>1_875_000)return null;
  return eventPayload('world.chunk.observed',at,{dimension,x:p.x,z:p.z,subChunkCount:finiteInt(p.sub_chunk_count)?p.sub_chunk_count:null,
   cacheEnabled:p.cache_enabled===true,payloadBytes:Buffer.isBuffer(p.payload)?Math.min(p.payload.length,2*1024*1024):0,
   blobCount:Array.isArray(p.blobs)?Math.min(p.blobs.length,64):0});
 }
 case 'subchunk':case 'sub_chunk':{
  const dimension=safeDimension(p.dimension??bridge?.dimension),center=p.center??p.origin;
  if(dimension===null||!center||![center.x,center.y,center.z].every(v=>finiteInt(Number(v))))return null;
  const entries=Array.isArray(p.entries)?p.entries:Array.isArray(p.sub_chunk_data)?p.sub_chunk_data:[];
  const sections=[];
  for(const e of entries.slice(0,48)){
   const o=e?.sub_chunk_pos_offset??e?.subChunkPosOffset??e?.offset??e;
   const dx=o?.x??o?.dx,dy=o?.y??o?.dy,dz=o?.z??o?.dz;
   if(![dx,dy,dz].every(finiteInt))continue;
   sections.push({x:Number(center.x)+dx,y:Number(center.y)+dy,z:Number(center.z)+dz,
    result:String(e?.result??e?.sub_chunk_request_result??'unknown').slice(0,32)});
  }
  return eventPayload('world.subchunks.observed',at,{dimension,sections});
 }
 case 'update_block':{
  const dimension=safeDimension(bridge?.dimension??p.dimension),position=safePosition(p.position);
  if(dimension===null||!position||!finiteInt(p.block_runtime_id)||p.block_runtime_id<0||p.block_runtime_id>0xffffffff)return null;
  return eventPayload('world.block.updated',at,{dimension,position,runtimeId:p.block_runtime_id,layer:finiteInt(p.layer)?p.layer:0});
 }
 case 'move_player':case 'move_actor_absolute':case 'move_actor_delta':{
  const dimension=safeDimension(bridge?.dimension);
  const id=runtimeId(p.runtime_entity_id??p.runtime_id??p.actor_runtime_id??p.entity_id_self??p.entity_id);
  const position=id?actorPosition(p,bridge,id,dimension):null;if(!id||!position||dimension===null)return null;
  return eventPayload('world.entity.moved',at,{entityId:id,self:id===runtimeId(bridge?.self),dimension,
   position,mode:typeof p.mode==='string'||finiteInt(p.mode)?p.mode:null,
   yaw:finiteNumber(p.yaw)?p.yaw:null,pitch:finiteNumber(p.pitch)?p.pitch:null});
 }
 case 'add_player':case 'add_actor':case 'add_entity':case 'add_item_entity':{
  const id=runtimeId(p.runtime_entity_id??p.runtime_id??p.entity_runtime_id??p.actor_runtime_id),position=safePosition(p.position);
  if(!id||!position)return null;
  const entityType=name==='add_player'?'player':name==='add_item_entity'?'item_drop':name==='add_actor'?'mob':'entity';
  const rawIdentifier=p.entity_type??p.identifier??p.entityType;
  const identifier=typeof rawIdentifier==='string'&&/^(?:minecraft:)?[a-z0-9_]{1,64}$/i.test(rawIdentifier)?rawIdentifier.replace(/^minecraft:/,'').toLowerCase().slice(0,64):null;
  return eventPayload('world.entity.added',at,{entityId:id,entityType,identifier,dimension:safeDimension(bridge?.dimension),position});
 }
 case 'remove_actor':case 'remove_entity':{
  const id=runtimeId(p.entity_id_self??p.runtime_entity_id??p.runtime_id??p.entity_id??p.actor_runtime_id);
  return id?eventPayload('world.entity.removed',at,{entityId:id}):null;
 }
 case 'set_time':return finiteInt(p.time)?eventPayload('world.time.observed',at,{time:p.time,daylightCycle:finiteNumber(p.time_of_day)?p.time_of_day:null}):null;
 case 'inventory_content':{
  const inv=bridge?.inventoryLedger?.playerInventory?.({maxAgeMs:15_000});
  if(!inv||inv.known!==true)return eventPayload('inventory.snapshot.unavailable',at,{});
  const counts=Object.create(null);
  for(const item of(Array.isArray(inv.items)?inv.items:[]).slice(0,256)){
   if(item?.empty===true||typeof item?.itemName!=='string'||!/^minecraft:[a-z0-9_./-]{1,80}$/.test(item.itemName)||!finiteInt(item.count)||item.count<1)continue;
   counts[item.itemName]=Math.min(1_000_000,(counts[item.itemName]??0)+item.count);
  }
  return eventPayload('inventory.snapshot.observed',at,{counts,revision:finiteInt(inv.revision)?inv.revision:null,
   generation:finiteInt(inv.generation)?inv.generation:null,observedAt:finiteNumber(inv.observedAt)?inv.observedAt:null,
   fresh:inv.fresh===true,registryKnown:inv.registryKnown===true});
 }
 default:return null;
 }
}
module.exports={normalizePacket,safeDimension,safePosition,runtimeId};
