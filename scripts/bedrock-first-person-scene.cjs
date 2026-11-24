'use strict';

// Sparse, conservative scene reconstruction. Only server-observed, decoded
// blocks with registry-resolved names are exported. No synthetic world fill.
const MAX_CUBES = 144;
const MAX_ENTITIES = 16;
function type(name) {
  if (!name || /^(minecraft:)?(?:air|cave_air|void_air)$/.test(name)) return 0;
  if (/minecraft:(?:water|flowing_water)$/.test(name)) return 5;
  if (/minecraft:(?:lava|flowing_lava)$/.test(name)) return 6;
  if (/minecraft:.*(?:leaves|vine|moss)/.test(name)) return 4;
  if (/minecraft:.*(?:log|wood|stem|planks)/.test(name)) return 3;
  if (/minecraft:.*(?:grass_block|dirt|mud|farmland)/.test(name)) return 1;
  if (/minecraft:.*(?:stone|deepslate|cobble|ore|tuff|andesite|granite)/.test(name)) return 2;
  if (/minecraft:.*(?:sand|gravel|terracotta)/.test(name)) return 7;
  // Skip fluids/hazards and partial blocks whose collision/display box isn't
  // a cube. A generic color does not imply true Minecraft textures.
  return 8;
}
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) &&
    Math.abs(value) <= 30000000;
}
function scene(world) {
  if (!world || world.closed || !world.spawned || world.respawnRecovery?.state !== 'alive' ||
      !world.position || !world.terrain || world.dimension == null) {
    return {available:false,reason:'world_not_ready',cubes:[],entities:[]};
  }
  const {position:p,terrain,dimension:dim}=world;
  if (![p.x,p.y,p.z].every(finite)) return {available:false,reason:'position_unknown',cubes:[],entities:[]};
  const yaw=finite(world.yaw)?world.yaw:null;
  const pitch=finite(world.pitch)?world.pitch:null;
  if (yaw===null || pitch===null) {
    return {available:false,reason:'camera_rotation_unobserved',cubes:[],entities:[]};
  }
  const x=Math.floor(p.x),y=Math.floor(p.y),z=Math.floor(p.z);
  const found=[];
  for(let dx=-6;dx<=6;dx++)for(let dz=-6;dz<=6;dz++)for(let dy=-3;dy<=3;dy++){
    const bx=x+dx,by=y+dy,bz=z+dz;
    const name=terrain.blockName(dim,bx,by,bz);
    if (!name)continue;
    const color=type(name);
    if(!color)continue;
    // Exclude voxels that cannot safely be approximated as cubes.
    if (color===8 && terrain.kind(dim,bx,by,bz)!=='solid')continue;
    const dist=dx*dx+dz*dz+dy*dy;
    found.push({dx:bx-p.x,dy:by-p.y,dz:bz-p.z,type:color,dist});
  }
  found.sort((a,b)=>a.dist-b.dist);
  const cubes=found.slice(0,MAX_CUBES).map(({dx,dy,dz,type})=>[
    Math.round(dx*100)/100,Math.round(dy*100)/100,Math.round(dz*100)/100,type
  ]);
  const seen=world.lifeSenses?.snapshot?.({
    position:p,dimension:dim,spawned:world.spawned,
    respawnState:'alive',terrain:null
  })?.nearbyEntities??[];
  const entities=[];
  for(const e of seen) {
    const q=e?.position;
    if (!q || ![q.x,q.y,q.z].every(finite))continue;
    const dx=q.x-p.x,dy=q.y-p.y,dz=q.z-p.z;
    if(Math.hypot(dx,dy,dz)>16)continue;
    entities.push([Math.round(dx*100)/100,Math.round(dy*100)/100,
      Math.round(dz*100)/100,e.hostile?2:e.kind==='player'?1:3]);
    if(entities.length>=MAX_ENTITIES)break;
  }
  return {
    available:true,kind:'reconstructed_voxel_camera',
    yaw:Math.round(yaw*10)/10,pitch:Math.round(pitch*10)/10,
    eyeHeight:1.62,range:6,decodedBlocks:cubes.length,
    cubes,entities,model:'untextured_approximate_cubes',
    limitations:'partial_blocks_unrendered_unknown_terrain_hidden'
  };
}
module.exports={buildFirstPersonScene:scene};
