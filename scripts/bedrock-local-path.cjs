'use strict';
const {searchVoxelAStar,GoalBlock}=require('./runtime/bedrock/navigation/voxel.cjs');
const {octileDistance}=require('./runtime/bedrock/navigation/astar.cjs');
const {estimateStepCost}=require('./runtime/bedrock/navigation/costs.cjs');
const CARDINAL=[[1,0],[-1,0],[0,1],[0,-1]];
function tileIsSafe(terrain,dimension,x,y,z){
 if(terrain.tile(dimension,x,y,z)!=='walkable')return false;
 for(const [dx,dz] of CARDINAL)if(terrain.tile(dimension,x+dx,y,z+dz)==='hazard')return false;
 return true;
}
function planLocalRoute(terrain,dimension,start,target,options={}){
 const failure=(reason,expanded=0)=>({status:'unverified',reason,waypoint:null,path:[],expanded,cost:null,executed:false,jump:false});
 if(!terrain||typeof terrain.tile!=='function'||![dimension,start?.x,start?.y,start?.z,target?.x,target?.y,target?.z].every(Number.isFinite))return failure('invalid_position');
 if(!Number.isInteger(dimension)||![0,1,2].includes(dimension))return failure('invalid_dimension');
 const startCell={x:Math.floor(start.x),y:Math.floor(start.y-1.62+0.01),z:Math.floor(start.z)};
 const targetCell={x:Math.floor(target.x),y:Math.floor(target.y-1.62+0.01),z:Math.floor(target.z)};
 const radius=Math.max(2,Math.min(24,Number.isFinite(options.radius)?Math.floor(options.radius):9));
 const verticalRadius=Math.max(0,Math.min(6,Number.isFinite(options.verticalRadius)?Math.floor(options.verticalRadius):4));
 if(Math.abs(startCell.x-targetCell.x)>radius||Math.abs(startCell.z-targetCell.z)>radius)return failure('target_outside_verified_local_radius');
 if(Math.abs(startCell.y-targetCell.y)>verticalRadius)return failure('target_outside_verified_vertical_radius');
 const isStandable=(x,y,z)=>tileIsSafe(terrain,dimension,x,y,z);
 if(!isStandable(startCell.x,startCell.y,startCell.z))return failure('start_not_verified_walkable');
 if(!isStandable(targetCell.x,targetCell.y,targetCell.z))return failure('target_not_verified_walkable');
 const getNeighbors=point=>{
  const out=[];
  for(const [dx,dz] of CARDINAL){const x=point.x+dx,z=point.z+dz;
   for(const [dy,mode] of [[0,'walk'],[1,'jump'],[-1,'fall']]){
    const y=point.y+dy;if(Math.abs(y-startCell.y)>verticalRadius||!isStandable(x,y,z))continue;
    out.push({position:{x,y,z},mode,verified:true});
   }
  }
  return out;
 };
 const result=searchVoxelAStar({start:startCell,goal:new GoalBlock(targetCell.x,targetCell.y,targetCell.z),isStandable,getNeighbors,
  canTraverse:(from,to,edge)=>edge?.verified===true&&Math.abs(to.x-from.x)+Math.abs(to.z-from.z)===1&&Math.abs(to.y-from.y)<=1,
  cost:(from,to,edge)=>estimateStepCost({mode:edge?.mode,verified:edge?.verified===true}),
  horizontalRadius:radius,verticalRadius,maxExpanded:options.maxExpanded??768,maxPath:options.maxPathLength??96});
 if(result.status!=='preview')return failure(result.reason,result.expanded);
 if(result.path.length<2)return failure('target_already_reached',result.expanded);
 const path=result.path.map(p=>({x:p.x+0.5,y:p.y+1.62,z:p.z+0.5}));
 const verticalDelta=result.path[1].y-startCell.y;
 return {status:'route_found',reason:'verified_voxel_route_found',waypoint:path[1],path,expanded:result.expanded,cost:result.cost,
  executed:false,jump:verticalDelta===1,waypointMode:verticalDelta===1?'jump':verticalDelta===-1?'fall':'walk',verticalDelta};
}
module.exports={planLocalRoute,tileIsSafe,octileDistance};
