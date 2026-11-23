'use strict';

/**
 * Strict A* over actual, decoded, vanilla-network-registered 1.26.60 blocks.
 * Never converts an unknown cell into "air". A path is only a proposal until
 * host accepts movement input and confirms the resulting position.
 */
function tileIsSafe(terrain,dim,x,y,z){
  if(terrain.tile(dim,x,y,z)!=='walkable')return false;
  // No close lava/fire/water hazards; avoid path hugging source blocks.
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const t=terrain.tile(dim,x+dx,y,z+dz);
    if(t==='hazard')return false;
  }
  return true;
}
function planLocalRoute(terrain,dimension,start,target,options={}){
  const failure=(reason,expanded=0)=>({
    status:'unverified',reason,waypoint:null,path:[],expanded,executed:false
  });
  if(!terrain || ![dimension,start?.x,start?.y,start?.z,
      target?.x,target?.y,target?.z].every(Number.isFinite))
    return failure('invalid_position');
  if(!Number.isInteger(dimension)||![0,1,2].includes(dimension))return failure('invalid_dimension');
  const y=Math.floor(start.y-1.62+0.01);
  const targetY=Math.floor(target.y-1.62+0.01);
  if(y!==targetY)return failure('different_vertical_level');
  const sx=Math.floor(start.x),sz=Math.floor(start.z),
    tx=Math.floor(target.x),tz=Math.floor(target.z);
  const radius=Math.max(2,Math.min(12,options.radius??9));
  const dx=Math.abs(sx-tx),dz=Math.abs(sz-tz);
  if(dx>radius||dz>radius)return failure('target_outside_verified_local_radius');
  const maxExpanded=256;
  if(!tileIsSafe(terrain,dimension,sx,y,sz) ||
     !tileIsSafe(terrain,dimension,tx,y,tz))
    return failure('start_or_target_not_verified_walkable');
  const key=(x,z)=>x+','+z;
  const frontier=[{x:sx,z:sz,cost:0,estimate:dx+dz}];
  const previous=new Map(),cost=new Map([[key(sx,sz),0]]);
  const seen=new Set();
  let expanded=0;
  while(frontier.length && expanded<maxExpanded){
    frontier.sort((a,b)=>(a.cost+a.estimate)-(b.cost+b.estimate));
    const current=frontier.shift();
    const at=key(current.x,current.z);
    if(seen.has(at))continue;
    seen.add(at);expanded++;
    if(current.x===tx && current.z===tz){
      const path=[];let cursor=at;
      while(cursor){
        const [x,z]=cursor.split(',').map(Number);
        path.push({x:x+0.5,y:y+1.62,z:z+0.5});
        cursor=previous.get(cursor);
        if(path.length>60)return failure('path_too_long',expanded);
      }
      path.reverse();
      return {status:'route_found',reason:'fully_verified_local_grid',
        waypoint:path[1]??path[0],path,expanded,executed:false};
    }
    for(const [mx,mz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const x=current.x+mx,z=current.z+mz;
      if(Math.abs(x-sx)>radius||Math.abs(z-sz)>radius)continue;
      const next=key(x,z);
      if(seen.has(next)||!tileIsSafe(terrain,dimension,x,y,z))continue;
      const g=current.cost+1;
      if(g>= (cost.get(next)??Infinity))continue;
      cost.set(next,g);previous.set(next,at);
      frontier.push({x,z,cost:g,estimate:Math.abs(x-tx)+Math.abs(z-tz)});
    }
  }
  return failure(expanded===maxExpanded?'search_budget_exceeded':'no_verified_route',expanded);
}
module.exports={planLocalRoute,tileIsSafe};
