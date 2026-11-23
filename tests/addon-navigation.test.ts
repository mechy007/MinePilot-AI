import test from 'node:test';
import assert from 'node:assert/strict';
import { BedrockMotionArbiter } from '../src/gameplay/addon-navigation.js';

const start = {x:0,y:64,z:0};
const world = (observedAt:number, position=start, collisionVerified=false, extras={}) =>
  ({position,dimension:0,observedAt,collisionVerified,...extras});

test('addon navigation priority gives emergency survival ownership over job and follow',()=>{
  let now=1000;
  const nav=new BedrockMotionArbiter(()=>now);
  assert.equal(nav.request('follow','walk',{x:10,y:64,z:0},1000).accepted,true);
  assert.equal(nav.update(world(now)).owner,'follow');
  assert.equal(nav.request('job','walk',{x:2,y:64,z:3},1000).accepted,true);
  assert.equal(nav.update(world(now)).owner,'job');
  assert.equal(nav.request('survival','walk',{x:1,y:64,z:5},1000).accepted,true);
  assert.equal(nav.update(world(now)).owner,'survival');
  assert.equal(nav.snapshot().executed,false);
  assert.equal(nav.snapshot().state,'awaiting_server');
  nav.release('survival');
  assert.equal(nav.update(world(now)).owner,'job');
  now+=1001;
  assert.equal(nav.update(world(now)).state,'idle');
  assert.equal(nav.snapshot().owner,null);
});

test('navigation intentions reject malformed and unbounded commands',()=>{
  const nav=new BedrockMotionArbiter(()=>1000);
  assert.equal(nav.request('unknown','walk',{x:1,y:64,z:2},1000).accepted,false);
  assert.equal(nav.request('follow','fly',{x:1,y:64,z:2},1000).accepted,false);
  assert.equal(nav.request('follow','walk',{x:Infinity,y:64,z:2},1000).accepted,false);
  assert.equal(nav.request('follow','walk',{x:1,y:64,z:2},10000).accepted,false);
  assert.equal(nav.request('follow','hold',{x:1,y:64,z:2},1000).accepted,true);
  assert.equal(nav.update(world(1000)).reason,'orientation_only');
  assert.equal(nav.snapshot().executed,false);
});

test('progress monitoring requires fresh server sample; never guesses safe detours',()=>{
  let now=1000;
  const nav=new BedrockMotionArbiter(()=>now);
  nav.request('follow','walk',{x:10,y:64,z:0},5000);
  assert.equal(nav.update(world(now,start,true)).state,'ready_for_verified_executor');
  for(let i=0;i<25;i++) {
    now+=50;
    nav.update(world(now,start,true));
  }
  assert.equal(nav.snapshot().stuckSamples,25);
  assert.equal(nav.snapshot().state,'stuck_requires_verified_terrain');
  assert.equal(nav.snapshot().waypoint,null);
  assert.equal(nav.snapshot().executed,false);
  now+=50;
  nav.update(world(now,start,true,{
    nearbyVerifiedWalkable:[{x:0,y:64,z:3},{x:2,y:64,z:0}]
  }));
  assert.equal(nav.snapshot().reason,'verified_detour_proposal');
  assert.equal(nav.snapshot().waypoint?.x,2);
  now+=50;
  nav.update(world(now,{x:0.4,y:64,z:0},true));
  assert.equal(nav.snapshot().stuckSamples,0);
  assert.ok(nav.snapshot().progressMeters>=0.4);
});

test('safety abort clears all intents and dimension change resets progress',()=>{
  let now=1000;
  const nav=new BedrockMotionArbiter(()=>now);
  nav.request('job','sprint',{x:12,y:64,z:12},1000);
  assert.equal(nav.update(world(now,start,false,{safetyHold:true})).state,'blocked_by_safety');
  assert.equal(nav.update(world(now)).state,'idle');
  nav.request('follow','walk',{x:3,y:64,z:0},2000);
  nav.update(world(now));
  now+=20;
  nav.update(world(now,{x:0.3,y:64,z:0}));
  assert.ok(nav.snapshot().progressMeters>=0.3);
  now+=20;
  assert.equal(nav.update({...world(now),dimension:1}).progressMeters,0);
  nav.emergencyStop();
  assert.equal(nav.snapshot().owner,null);
});
