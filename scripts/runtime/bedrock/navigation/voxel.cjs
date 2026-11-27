'use strict';
const {MinHeap}=require('./astar.cjs');
const {GoalBlock,GoalNear,GoalXZ,GoalFollow,validGoalPosition}=require('./goals.cjs');
const {estimateStepCost}=require('./costs.cjs');
const keyOf=p=>String(p.x)+','+String(p.y)+','+String(p.z);
const heuristic=(goal,p)=>typeof goal?.heuristic==='function'?goal.heuristic(p):Infinity;
/** Bounded 3D route preview. Default edges are verified same-height walking only. */
function searchVoxelAStar(options={}) {
  const {start,goal,isStandable,getNeighbors}=options;
  const fail=reason=>({status:'unverified',reason,path:[],cost:null,expanded:0,executable:false});
  if(!validGoalPosition(start)||typeof isStandable!=='function'||!goal||
    typeof goal.isEnd!=='function'||typeof goal.heuristic!=='function')return fail('invalid_voxel_search_contract');
  const maxExpanded=Number.isInteger(options.maxExpanded)?Math.max(1,Math.min(4096,options.maxExpanded)):512;
  const maxPath=Number.isInteger(options.maxPath)?Math.max(1,Math.min(128,options.maxPath)):64;
  const horizontalRadius=Number.isInteger(options.horizontalRadius)?Math.max(1,Math.min(64,options.horizontalRadius)):16;
  const verticalRadius=Number.isInteger(options.verticalRadius)?Math.max(0,Math.min(32,options.verticalRadius)):0;
  const neighbors=typeof getNeighbors==='function'?getNeighbors:n=>[
    {x:n.x+1,y:n.y,z:n.z,mode:'walk',verified:true},{x:n.x-1,y:n.y,z:n.z,mode:'walk',verified:true},
    {x:n.x,y:n.y,z:n.z+1,mode:'walk',verified:true},{x:n.x,y:n.y,z:n.z-1,mode:'walk',verified:true}];
  if(isStandable(start.x,start.y,start.z)!==true)return fail('start_not_verified_standable');
  const startKey=keyOf(start),heap=new MinHeap((a,b)=>a.f-b.f||a.h-b.h||a.sequence-b.sequence);
  let sequence=0; const initialH=heuristic(goal,start); if(!Number.isFinite(initialH))return fail('goal_not_resolvable');
  heap.push({point:{...start},key:startKey,g:0,h:initialH,f:initialH,sequence:sequence++});
  const costs=new Map([[startKey,0]]),previous=new Map(),closed=new Set(); let expanded=0;
  while(heap.size&&expanded<maxExpanded){
    const node=heap.pop(); if(closed.has(node.key)||node.g!==costs.get(node.key))continue;
    closed.add(node.key); expanded++;
    if(goal.isEnd(node.point)){
      const path=[];let cursor=node.key;
      while(cursor){path.push({x:Number(cursor.split(',')[0]),y:Number(cursor.split(',')[1]),z:Number(cursor.split(',')[2])});
        cursor=previous.get(cursor)?.from??null;if(path.length>maxPath)return {status:'unverified',reason:'path_length_budget_exceeded',path:[],cost:null,expanded,executable:false};}
      path.reverse();return {status:'preview',reason:'verified_voxel_route_found',path,cost:node.g,expanded,executable:false,source:'minepilot_verified_terrain'};
    }
    let next;try{next=neighbors(node.point);}catch{return fail('neighbor_provider_failed');}
    if(!Array.isArray(next))return fail('neighbor_provider_contract_invalid');
    for(const edge of next.slice(0,32)){
      const point=edge?.position??edge;if(!validGoalPosition(point))continue;
      if(Math.abs(point.x-start.x)>horizontalRadius||Math.abs(point.z-start.z)>horizontalRadius||
        Math.abs(point.y-start.y)>verticalRadius)continue;
      if(typeof options.canTraverse==='function'&&options.canTraverse(node.point,point,edge)!==true)continue;
      if(typeof options.canTraverse!=='function'&&(point.y!==node.point.y||edge?.mode!=='walk'))continue;
      if(isStandable(point.x,point.y,point.z)!==true)continue;
      const stepCost=typeof options.cost==='function'?options.cost(node.point,point,edge):
        estimateStepCost({mode:edge?.mode??'walk',verified:edge?.verified===true});
      if(!Number.isFinite(stepCost)||stepCost<=0||stepCost>100000)continue;
      const k=keyOf(point);if(closed.has(k))continue;const g=node.g+stepCost;if(g>=(costs.get(k)??Infinity))continue;
      const h=heuristic(goal,point);if(!Number.isFinite(h))continue;costs.set(k,g);previous.set(k,{from:node.key,edge});
      heap.push({point:{x:point.x,y:point.y,z:point.z},key:k,g,h,f:g+h,sequence:sequence++});
    }
  }
  return fail(expanded>=maxExpanded?'search_budget_exceeded':'no_verified_voxel_route');
}
module.exports={searchVoxelAStar,GoalBlock,GoalNear,GoalXZ,GoalFollow};
