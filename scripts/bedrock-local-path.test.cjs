'use strict';
const assert=require('node:assert/strict');const {test}=require('node:test');
const {planLocalRoute,octileDistance}=require('./bedrock-local-path.cjs');
const key=(x,y,z)=>[x,y,z].join(',');
function world({walkable=null,blocked=new Set(),unknown=new Set(),hazard=new Set()}={}){
 return {tile(_d,x,y,z){const k=key(x,y,z);if(hazard.has(k))return 'hazard';if(blocked.has(k))return 'blocked';
  if(unknown.has(k))return 'unknown';return walkable===null||walkable.has(k)?'walkable':'unknown';}};
}
const pos=(x,z,y=65.62)=>({x:x+0.5,y,z:z+0.5}),cell=(x,y,z)=>key(x,y,z);
test('voxel A* returns bounded cardinal paths and does not cut diagonally',()=>{
 const r=planLocalRoute(world(),0,pos(0,0),pos(3,3));assert.equal(r.status,'route_found');assert.equal(r.path.length,7);
 for(let i=1;i<r.path.length;i++)assert.equal(Math.abs(Math.floor(r.path[i-1].x)-Math.floor(r.path[i].x))+
  Math.abs(Math.floor(r.path[i-1].z)-Math.floor(r.path[i].z)),1);
 assert.equal(r.executed,false);assert.equal(r.jump,false);assert.equal(r.cost,6);
});
test('A* routes around blocked cells using observed walkable terrain',()=>{
 const t=world({blocked:new Set([cell(1,64,0),cell(0,64,1)])}),r=planLocalRoute(t,0,pos(0,0),pos(1,1));
 assert.equal(r.status,'route_found');assert.ok(r.path.length>3);
 assert.equal(r.path.some(p=>t.tile(0,Math.floor(p.x),Math.floor(p.y-1.62),Math.floor(p.z))==='blocked'),false);
});
test('unknown destination terrain is rejected without guessing',()=>{
 const r=planLocalRoute(world({unknown:new Set([cell(1,64,1)])}),0,pos(0,0),pos(1,1));
 assert.equal(r.status,'unverified');assert.equal(r.reason,'target_not_verified_walkable');
});
test('one-block rise produces a jump-enabled first step',()=>{
 const t=world({walkable:new Set([cell(0,64,0),cell(1,65,0),cell(2,65,0)])});
 const r=planLocalRoute(t,0,pos(0,0),pos(2,0,66.62));assert.equal(r.status,'route_found');
 assert.equal(r.jump,true);assert.equal(r.waypointMode,'jump');assert.equal(r.path[1].y,66.62);
});
test('one-block descent is allowed while a sudden two-block drop is rejected',()=>{
 const down=world({walkable:new Set([cell(0,65,0),cell(1,64,0)])});
 const r=planLocalRoute(down,0,pos(0,0,66.62),pos(1,0,65.62));
 assert.equal(r.status,'route_found');assert.equal(r.waypointMode,'fall');
 const cliff=world({walkable:new Set([cell(0,65,0),cell(1,63,0)])});
 assert.equal(planLocalRoute(cliff,0,pos(0,0,66.62),pos(1,0,64.62)).status,'unverified');
});
test('hazards remain hard route barriers',()=>{
 const t=world({walkable:new Set([cell(0,64,0),cell(1,64,0),cell(2,64,0)]),hazard:new Set([cell(1,64,0)])});
 assert.equal(planLocalRoute(t,0,pos(0,0),pos(2,0)).status,'unverified');
});
test('search and path budgets remain bounded',()=>{
 const r=planLocalRoute(world(),0,pos(0,0),pos(24,24),{radius:24,maxExpanded:16});
 assert.equal(r.status,'unverified');assert.equal(r.reason,'search_budget_exceeded');assert.ok(r.expanded<=16);
});
test('octile heuristic remains correct for straight and diagonal distances',()=>{
 assert.equal(octileDistance(4,0),4);assert.ok(Math.abs(octileDistance(4,4)-4*Math.SQRT2)<1e-9);
});
