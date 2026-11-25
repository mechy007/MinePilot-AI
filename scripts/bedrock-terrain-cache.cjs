'use strict';

/**
 * Conservative Bedrock chunk/subchunk decoder for the same authenticated
 * NetherNet player session. Derived from the Bedrock palette wire layout
 * and from studying Bedrock bot terrain implementations.
 *
 * A successfully decoded runtime ID is NOT proof of air or safe footing.
 * Block classification requires an explicit version-matching registry.
 * Unknown/cached/unsupported chunks never become imaginary walkable tiles.
 */
const MAX_PAYLOAD = 2 * 1024 * 1024;
const MAX_SECTIONS = 256;  // <5 MiB at 4096*4 bytes per section
const MAX_PALETTE = 4096;
const CELLS = 4096;

function readUint(buf, state) {
  let out = 0, mul = 1;
  for (let i = 0; i < 5; i++) {
    if (state.offset >= buf.length) throw new Error('truncated_varuint');
    const b = buf[state.offset++];
    out += (b & 127) * mul;
    if (out > 0xffffffff) throw new Error('varuint_overflow');
    if (!(b & 128)) return out;
    mul *= 128;
  }
  throw new Error('varuint_too_long');
}
function parseStorage(buf, state) {
  if (state.offset >= buf.length) throw new Error('truncated_storage');
  const header = buf[state.offset++];
  const bits = header >>> 1, runtime = (header & 1) === 1;
  if (!runtime || ![0,1,2,3,4,5,6,8,16].includes(bits))
    throw new Error('unsupported_network_palette');
  const indices = new Uint16Array(CELLS);
  if (bits) {
    const perWord = Math.floor(32/bits);
    const words = Math.ceil(CELLS/perWord);
    if (state.offset + 4*words > buf.length) throw new Error('truncated_bit_array');
    const mask = (1<<bits)-1;
    for (let word=0;word<words;word++) {
      const packed=buf.readUInt32LE(state.offset);state.offset+=4;
      for(let b=0;b<perWord;b++) {
        const ix=word*perWord+b;
        if(ix<CELLS)indices[ix]=(packed >>> (bits*b))&mask;
      }
    }
  }
  const paletteLength=readUint(buf,state);
  if (!paletteLength || paletteLength>MAX_PALETTE ||
      paletteLength > (bits ? 2**bits : 1))
    throw new Error('invalid_palette_size');
  const palette=new Uint32Array(paletteLength);
  for (let i=0;i<paletteLength;i++) palette[i]=readUint(buf,state);
  const blocks=new Uint32Array(CELLS);
  for (let i=0;i<CELLS;i++) {
    if(indices[i]>=paletteLength) throw new Error('unmapped_block_index');
    blocks[i]=palette[indices[i]];
  }
  return blocks;
}
function parseSubchunk(buf, offset=0, impliedY=-4) {
  if (!Buffer.isBuffer(buf) || buf.length>MAX_PAYLOAD || offset<0 ||
      !Number.isInteger(offset) || offset>=buf.length)
    throw new Error('invalid_subchunk_payload');
  const state={offset};
  const version=buf[state.offset++];
  if (![8,9].includes(version)) throw new Error('unsupported_subchunk_version');
  if (state.offset >= buf.length) throw new Error('truncated_subchunk');
  const layers=buf[state.offset++];
  if (layers<1 || layers>2) throw new Error('unsupported_storage_layers');
  let sectionY=impliedY;
  if(version===9) {
    if(state.offset>=buf.length)throw new Error('missing_section_y');
    sectionY=buf.readInt8(state.offset++);
  }
  if(!Number.isInteger(sectionY) || sectionY < -16 || sectionY > 32)
    throw new Error('invalid_section_y');
  const blocks=parseStorage(buf,state);
  const waterlogged=layers>1?parseStorage(buf,state):null;
  return {sectionY,blocks,waterlogged,bytesRead:state.offset-offset};
}
function isInt(v) { return Number.isInteger(v) && Math.abs(v)<1875000; }
function validDim(v) { return Number.isInteger(v) && v>=0 && v<=2; }
function xyzKey(dim,cx,cz,sy) {return [dim,cx,cz,sy].join(':');}
function localIndex(x,y,z) { return (x&15) | ((z&15)<<4) | ((y&15)<<8); }
class BedrockTerrainCache {
  constructor() {
    this.sections=new Map();
    this.updates=new Map();
    this.dimension=null;
    this.decodeErrors=0;
    this.decoded=0;
    this.cacheMisses=0;
    this.registry=null;
    this.airRuntimeId=null;
  }
  reset(dimension=null) {
    this.sections.clear();this.updates.clear();
    this.dimension=validDim(dimension)?dimension:null;
    this.decoded=0;this.cacheMisses=0;
  }
  // Explicit version-matched network state registry only; do not infer
  // that an unknown runtime ID is air or solid.
  setRegistry(mapping) {
    if (!(mapping instanceof Map) || mapping.size>131072) return false;
    this.registry=new Map();
    this.airRuntimeId=null;
    for (const [key,value] of mapping) {
      if(!Number.isInteger(key)||key<0||key>=0x100000000)continue;
      const name=typeof value==='string'?value:value?.name;
      const boundingBox=typeof value==='object'?value?.boundingBox:null;
      if(typeof name==='string' && /^minecraft:[a-z0-9_./-]{1,90}$/.test(name))
        this.registry.set(key,{name,boundingBox});
      if(name==='minecraft:air') this.airRuntimeId=key;
    }
    return this.registry.size>0;
  }
  store(dim,cx,cz,sectionY,blocks,waterlogged=null) {
    const key=xyzKey(dim,cx,cz,sectionY);
    this.sections.delete(key);
    this.sections.set(key,{blocks,waterlogged,dimension:dim});
    while(this.sections.size>MAX_SECTIONS)
      this.sections.delete(this.sections.keys().next().value);
    this.decoded++;
  }
  levelChunk(packet) {
    if (!packet || !isInt(packet.x) || !isInt(packet.z) ||
      !validDim(packet.dimension) || packet.dimension!==this.dimension) return false;
    if (packet.cache_enabled || (packet.blobs?.length??0)>0) {
      this.cacheMisses++;return false;
    }
    const count=packet.sub_chunk_count;
    if(!Number.isInteger(count) || count<1 || count>24) return false;
    const payload=packet.payload;
    if(!Buffer.isBuffer(payload) || !payload.length || payload.length>MAX_PAYLOAD) {
      this.decodeErrors++;return false;
    }
    // Transactional: a bad subchunk cannot introduce partially trusted cells.
    const staged=[];
    try{
      let offset=0;
      for(let i=0;i<count;i++){
        const sub=parseSubchunk(payload,offset,packet.dimension===0?-4+i:i);
        offset+=sub.bytesRead;
        staged.push(sub);
      }
    }catch{this.decodeErrors++;return false;}
    for(const sub of staged)this.store(packet.dimension,packet.x,packet.z,
      sub.sectionY,sub.blocks,sub.waterlogged);
    return true;
  }
  subChunk(packet) {
    const dim=packet?.dimension;
    if (!validDim(dim)||dim!==this.dimension) return 0;
    // Protocol 2225 (Bedrock 1.26.60) names this field center. Keep origin as
    // a compatibility alias for older packet adapters and recorded fixtures.
    const center=packet?.center ?? packet?.origin;
    if(!center||!isInt(Number(center.x))||!isInt(Number(center.z))||
      !Number.isInteger(Number(center.y)))return 0;
    const entries=packet.entries ?? packet.sub_chunk_data;
    if(!Array.isArray(entries)||entries.length>48)return 0;
    let count=0;
    for(const e of entries){
      // SubChunkPacketData offsets are nested SubChunkPosOffset values
      // (x/y/z); flat dx/dy/dz aliases are accepted only for older adapters.
      const offset=e?.sub_chunk_pos_offset ?? e?.subChunkPosOffset ??
        e?.offset ?? e;
      const dx=offset?.x ?? offset?.dx;
      const dy=offset?.y ?? offset?.dy;
      const dz=offset?.z ?? offset?.dz;
      if(![dx,dy,dz].every(Number.isInteger))continue;
      const x=Number(center.x)+dx,z=Number(center.z)+dz,
        y=Number(center.y)+dy;
      if(!isInt(x)||!isInt(z)||y<-16||y>32)continue;
      const status=e.result ?? e.sub_chunk_request_result;
      if((status==='success_all_air'||status===6) && this.airRuntimeId != null){
        // Server-declared all-air; use the network palette's actual air state ID.
        const air=new Uint32Array(CELLS);air.fill(this.airRuntimeId);
        this.store(dim,x,z,y,air);
        count++;
      }else {
        const payload=e.payload ?? e.serialized_sub_chunk ?? e.serializedSubChunk;
        if((status==='success'||status===1)&&Buffer.isBuffer(payload)){
          try{
            const sub=parseSubchunk(payload,0,y);
            if(sub.sectionY!==y){this.decodeErrors++;continue;}
            this.store(dim,x,z,y,sub.blocks,sub.waterlogged);
            count++;
          }catch{this.decodeErrors++;}
        }
      }
    }
    return count;
  }
  updateBlock(packet, dimension=this.dimension) {
    if(!validDim(dimension)||dimension!==this.dimension ||
      !packet?.position || packet.layer!==0)return false;
    const {x,y,z}=packet.position, id=packet.block_runtime_id;
    if(![x,y,z,id].every(Number.isInteger)||Math.abs(x)>30000000||
      Math.abs(z)>30000000||y<-256||y>512||id<0||id>0xffffffff)return false;
    const key=xyzKey(dimension,x>>4,z>>4,Math.floor(y/16));
    const sec=this.sections.get(key);
    if(sec) {
      sec.blocks[localIndex(x,y,z)]=id;
      this.sections.delete(key);this.sections.set(key,sec);
    }else {
      const coord=[dimension,x,y,z].join(':');
      this.updates.delete(coord);this.updates.set(coord,id);
      while(this.updates.size>4096)this.updates.delete(this.updates.keys().next().value);
    }
    return true;
  }
  blockId(dim,x,y,z) {
    if(!validDim(dim)||dim!==this.dimension||
      ![x,y,z].every(Number.isInteger))return null;
    const key=xyzKey(dim,x>>4,z>>4,Math.floor(y/16));
    const section=this.sections.get(key);
    if(section) return section.blocks[localIndex(x,y,z)];
    return this.updates.get([dim,x,y,z].join(':')) ?? null;
  }
  blockName(dim,x,y,z) {
    const id=this.blockId(dim,x,y,z);
    if(id===null)return null;
    return this.registry?.get(id)?.name??null;
  }
  // Returns null for any unknown or ambiguous partial block.
  kind(dim,x,y,z) {
    const id=this.blockId(dim,x,y,z);
    const entry=id===null?null:this.registry?.get(id);
    const name=entry?.name;
    if(!name)return null;
    if(['minecraft:air','minecraft:cave_air','minecraft:void_air'].includes(name))return 'air';
    if(/^(minecraft:(water|flowing_water|lava|flowing_lava|fire|soul_fire|cactus))$/.test(name))
      return 'hazard';
    // Only a full-cube collision shape is treated as walkable support.
    // Partial/dynamic/honey/powder/unsupported shapes remain unknown.
    if(entry.boundingBox==='block' &&
      !/minecraft:(honey_block|slime|magma|powder_snow|soul_sand)$/.test(name))
      return 'solid';
    return null;
  }
  // No jump, parkour or multi-height navigation without voxel verification.
  tile(dim,x,y,z) {
    const ground=this.kind(dim,x,y-1,z);
    const feet=this.kind(dim,x,y,z);
    const head=this.kind(dim,x,y+1,z);
    if([ground,feet,head].some(x=>x===null))return 'unknown';
    if([ground,feet,head].some(x=>x==='hazard'))return 'hazard';
    return ground==='solid' && feet==='air' && head==='air'
      ? 'walkable':'blocked';
  }
  snapshot() {
    return {decodedSections:this.sections.size,
      observedBlockUpdates:this.updates.size,decodeErrors:this.decodeErrors,
      cacheMisses:this.cacheMisses,registryEntries:this.registry?.size??0,
      collisionClassificationReady:(this.registry?.size??0)>0,
      executed:false};
  }
}
module.exports={BedrockTerrainCache,parseSubchunk,parseStorage,localIndex};
