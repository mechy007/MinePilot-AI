'use strict';
/** Compatibility facade: MinePilot terrain classification stays authoritative. */
const { searchGridAStar } = require('./runtime/bedrock/navigation/astar.cjs');
function tileIsSafe(terrain,dim,x,y,z){
  if(terrain.tile(dim,x,y,z)!=='walkable')return false;
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]])
    if(terrain.tile(dim,x+dx,y,z+dz)==='hazard')return false;
  return true;
}
function planLocalRoute(terrain,dimension,start,target,options={}){
  const failure=(reason,expanded=0)=>({status:'unverified',reason,waypoint:null,path:[],expanded,executed:false});
  if(!terrain||![dimension,start?.x,start?.y,start?.z,target?.x,target?.y,target?.z].every(Number.isFinite))return failure('invalid_position');
  if(!Number.isInteger(dimension)||![0,1,2].includes(dimension))return failure('invalid_dimension');
  const y=Math.floor(start.y-1.62+0.01);
  if(Math.floor(target.y-1.62+0.01)!==y)return failure('different_vertical_level');
  const sx=Math.floor(start.x),sz=Math.floor(start.z),tx=Math.floor(target.x),tz=Math.floor(target.z);
  const radius=Math.max(2,Math.min(12,options.radius??9));
  if(Math.abs(sx-tx)>radius||Math.abs(sz-tz)>radius)return failure('target_outside_verified_local_radius');
  const search=searchGridAStar({start:{x:sx,z:sz},target:{x:tx,z:tz},radius,maxExpanded:256,
    isWalkable:(x,z)=>tileIsSafe(terrain,dimension,x,y,z)});
  if(search.status!=='found')return failure(search.reason,search.expanded);
  const path=search.path.map(p=>({x:p.x+0.5,y:y+1.62,z:p.z+0.5}));
  if(path.length>60)return failure('path_too_long',search.expanded);
  return {status:'route_found',reason:'fully_verified_local_grid',waypoint:path[1]??path[0],
    path,expanded:search.expanded,executed:false};
}
module.exports={planLocalRoute,tileIsSafe};
