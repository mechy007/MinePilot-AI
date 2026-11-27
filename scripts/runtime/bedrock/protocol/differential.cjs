'use strict';
const PACKET_ALIASES=Object.freeze({sub_chunk:'subchunk',subchunk:'subchunk',move_player:'move_player',
  update_block:'update_block',inventory_content:'inventory_content',item_stack_response:'item_stack_response',
  level_chunk:'level_chunk',start_game:'start_game'});
const SAFE_FIELDS=Object.freeze({
  start_game:['server_version','protocol_version','dimension','block_network_ids_are_hashes','current_tick','player_position'],
  level_chunk:['x','z','dimension','sub_chunk_count','cache_enabled'],
  subchunk:['dimension','center','origin','entries','sub_chunk_data'],
  update_block:['position','block_runtime_id','layer'],
  move_player:['runtime_entity_id','position','mode','yaw','pitch'],
  inventory_content:['window_id','container_id','input','items'],
  item_stack_response:['responses']
});
function normalizePacketName(v){return typeof v==='string'?PACKET_ALIASES[v]??v:null;}
function fieldShape(v,depth=0){
  if(depth>4)return 'depth_limit';if(v===null)return 'null';if(Array.isArray(v))return v.length?'array<'+fieldShape(v[0],depth+1)+'>':'array';
  if(typeof v==='bigint')return 'bigint';if(typeof v!=='object')return typeof v;
  return Object.fromEntries(Object.keys(v).sort().slice(0,128).map(k=>[k,fieldShape(v[k],depth+1)]));
}
function describePacketFixture(name,packet){
  const canonical=normalizePacketName(name),allowed=SAFE_FIELDS[canonical];
  if(!allowed||!packet||typeof packet!=='object'||Array.isArray(packet))return {status:'unsupported',canonical,fields:{}};
  const fields={};for(const key of allowed)if(Object.hasOwn(packet,key))fields[key]=fieldShape(packet[key]);
  return {status:'described',canonical,fields};
}
function comparePacketFixtures(a,b){
  if(!a||!b||a.status!=='described'||b.status!=='described'||a.canonical!==b.canonical)
    return {status:'incomparable',mismatches:[],reason:'fixture_packet_contract_mismatch'};
  const keys=new Set([...Object.keys(a.fields),...Object.keys(b.fields)]),mismatches=[];
  for(const key of keys)if(JSON.stringify(a.fields[key]??null)!==JSON.stringify(b.fields[key]??null))
    mismatches.push({field:key,left:a.fields[key]??null,right:b.fields[key]??null});
  return {status:mismatches.length?'mismatch':'matched',packet:a.canonical,comparedFields:keys.size,mismatches:mismatches.slice(0,64)};
}
module.exports={PACKET_ALIASES,SAFE_FIELDS,normalizePacketName,describePacketFixture,comparePacketFixtures};
