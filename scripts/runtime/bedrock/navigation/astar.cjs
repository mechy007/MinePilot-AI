'use strict';
class MinHeap {
  constructor(compare){this.a=[];this.compare=compare;}
  get size(){return this.a.length;}
  push(v){const a=this.a;a.push(v);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(this.compare(a[p],v)<=0)break;a[i]=a[p];i=p;}a[i]=v;}
  pop(){const a=this.a;if(!a.length)return null;const first=a[0],last=a.pop();if(a.length){let i=0;while(true){const l=i*2+1,r=l+1;if(l>=a.length)break;let c=l;if(r<a.length&&this.compare(a[r],a[l])<0)c=r;if(this.compare(last,a[c])<=0)break;a[i]=a[c];i=c;}a[i]=last;}return first;}
}
function searchGridAStar({start,target,isWalkable,radius=9,maxExpanded=256}={}){
  const fail=reason=>({status:'unverified',reason,path:[],expanded:0});
  const valid=p=>p&&Number.isInteger(p.x)&&Number.isInteger(p.z)&&Math.abs(p.x)<=30000000&&Math.abs(p.z)<=30000000;
  if(!valid(start)||!valid(target)||typeof isWalkable!=='function')return fail('invalid_grid_search_input');
  radius=Math.max(2,Math.min(12,radius));maxExpanded=Math.max(1,Math.min(2048,maxExpanded));
  if(Math.abs(start.x-target.x)>radius||Math.abs(start.z-target.z)>radius)return fail('target_outside_verified_local_radius');
  if(!isWalkable(start.x,start.z)||!isWalkable(target.x,target.z))return fail('start_or_target_not_verified_walkable');
  const key=(x,z)=>x+','+z,sk=key(start.x,start.z),tk=key(target.x,target.z);let sequence=0;
  const heap=new MinHeap((a,b)=>(a.g+a.h)-(b.g+b.h)||a.h-b.h||a.sequence-b.sequence);
  heap.push({x:start.x,z:start.z,g:0,h:Math.abs(start.x-target.x)+Math.abs(start.z-target.z),sequence:sequence++});
  const prev=new Map(),costs=new Map([[sk,0]]),closed=new Set();let expanded=0;
  while(heap.size&&expanded<maxExpanded){const n=heap.pop(),at=key(n.x,n.z);if(closed.has(at)||n.g!==costs.get(at))continue;closed.add(at);expanded++;
    if(at===tk){const path=[];let cur=at;while(cur){const [x,z]=cur.split(',').map(Number);path.push({x,z});cur=prev.get(cur);if(path.length>60)return {status:'unverified',reason:'path_too_long',path:[],expanded};}path.reverse();return {status:'found',reason:'fully_verified_local_grid',path,expanded};}
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const x=n.x+dx,z=n.z+dz,k=key(x,z);if(Math.abs(x-start.x)>radius||Math.abs(z-start.z)>radius||closed.has(k)||!isWalkable(x,z))continue;const g=n.g+1;if(g>=(costs.get(k)??Infinity))continue;costs.set(k,g);prev.set(k,at);heap.push({x,z,g,h:Math.abs(x-target.x)+Math.abs(z-target.z),sequence:sequence++});}
  }
  return {status:'unverified',reason:expanded>=maxExpanded?'search_budget_exceeded':'no_verified_route',path:[],expanded};
}
module.exports={MinHeap,searchGridAStar};
