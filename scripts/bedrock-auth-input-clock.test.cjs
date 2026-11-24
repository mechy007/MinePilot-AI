'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {AuthInputTickClock}=require('./bedrock-auth-input-clock.cjs');
const {ExperimentalPlayerInput,buildInputPacket}=require('./bedrock-player-input.cjs');

test('protocol 2225 wall-clock ticks catch up after a stalled 50ms scheduler without duplicate frames',()=>{
  let now=1000;
  const model=new AuthInputTickClock({clock:()=>now});
  assert.equal(model.seed(100n,1000),true);
  now+=50;assert.equal(model.next(),101n);
  now+=50;assert.equal(model.next(),102n);
  now+=650;assert.equal(model.next(),115n,
    'scheduler should reflect elapsed 50ms game ticks, not count callbacks');
  assert.equal(model.snapshot().skippedTicks,12);
  assert.equal(model.next(),116n,'multiple callbacks in one ms remain monotonic');
  assert.equal(model.snapshot().protocol,2225);
  assert.equal(model.snapshot().mode,'wall_clock_server_anchored');
});
test('corrections cannot rewind writer or anchor it to ancient ticks',()=>{
  let now=1000;
  const model=new AuthInputTickClock({clock:()=>now});
  assert.equal(model.seed(1000n),true);
  now+=50;
  assert.equal(model.next(),1001n);
  assert.equal(model.correction(1001n),true);
  now+=50;
  assert.equal(model.next(),1002n);
  assert.equal(model.correction(998n),false,'older ACK rejected');
  assert.equal(model.correction(-1n),false);
  assert.equal(model.correction(1010n),true);
  now+=50;
  assert.equal(model.next(),1011n);
  const snap=model.snapshot();
  assert.equal(snap.lastAck,'1010');
  assert.equal(snap.observedCorrections,2);
  assert.equal(snap.rejectedCorrections,2);
  model.reset();
  assert.equal(model.snapshot().lastTick,null);
  assert.throws(()=>model.next(),/not_seeded/);
});
test('input packet matches 1.26.60-1.26.66 camera orientation semantics and 2225 ordinals',()=>{
  const p={x:8.5,y:64,z:10.5};
  const f=buildInputPacket(p,90,101n,true,{pitch:30});
  assert.deepEqual(f.input_data,[10]);
  assert.equal(f.tick,101n);
  assert.equal(f.pitch,30);
  assert.equal(f.interact_rotation.x,30);
  const c=f.camera_orientation;
  assert.ok(Math.abs(Math.hypot(c.x,c.y,c.z)-1)<1e-8);
  assert.ok(Math.abs(c.x+Math.cos(Math.PI/6))<1e-8);
  assert.ok(Math.abs(c.y+0.5)<1e-8);
  assert.ok(Math.abs(c.z)<1e-8);
  const neutral=buildInputPacket(p,0,102n,false);
  assert.equal(neutral.position.x,p.x);
  assert.equal(neutral.position.z,p.z);
  assert.deepEqual(neutral.input_data,[]);
  assert.deepEqual(neutral.camera_orientation,{x:0,y:0,z:1});
  assert.throws(()=>buildInputPacket(p,NaN,100n,true),/Invalid/);
});
test('all four input modes share exactly one tick clock across presence, movement, neutral stop and correction',()=>{
  let now=1000,nextTimer=0;
  const timers=new Map();
  const sent=[];
  const client={queue:(name,params)=>sent.push({name,...params})};
  const movement=new ExperimentalPlayerInput(client,true,{
    presenceEnabled:true,clock:()=>now,
    setInterval(fn){const id=++nextTimer;timers.set(id,fn);return id;},
    clearInterval(id){timers.delete(id);}
  });
  const world={
    closed:false,spawned:true,self:'123',dimension:0,
    position:{x:8.5,y:64,z:10.5},yaw:90,pitch:12,
    movementAuthority:1,serverTick:100n,serverTickObservedAt:1000,
    lastServerPositionAt:1000,receivedChunks:new Set(['0,0'])
  };
  assert.equal(movement.startPresence(world),true);
  const fire=()=>{for(const cb of [...timers.values()])cb();};
  now+=50;fire();now+=50;fire();
  assert.deepEqual(sent.map(x=>x.tick),[101n,102n]);
  now+=650;fire();
  assert.equal(sent.at(-1).tick,115n);
  assert.equal(movement.runDiagnostic(world,{mode:'forward',ticks:2}).status,'accepted');
  now+=50;fire();
  assert.equal(sent.at(-1).tick,116n);
  assert.equal(sent.at(-1).input_data[0],10);
  const before=sent.length;now+=50;fire();
  assert.equal(sent.length,before+1);
  now+=50;fire(); // end-of-probe sends neutral
  assert.deepEqual(sent.slice(0).map(x=>x.tick),
    [...new Set(sent.map(x=>x.tick))],'only one writer owns each monotonically increasing tick');
  movement.correct(world.position,120n); // valid correction while presence active
  const latest=sent.at(-1).tick;
  now+=50;fire();
  assert.ok(sent.at(-1).tick>latest);
  assert.ok(movement.snapshot().inputClock.observedCorrections>=1);
  movement.resetSession();
  assert.equal(movement.snapshot().inputClock.lastTick,null);
  assert.equal(movement.snapshot().presenceActive,false);
  assert.equal(timers.size,0);
});
test('pinned protocol-2225 serializer accepts validated camera vectors and writer frames',()=>{
  const {createSerializer}=require('bedrock-protocol/src/transforms/serializer');
  const serializer=createSerializer('1.26.60');
  const p={x:8.5,y:64,z:10.5};
  for(const yaw of [0,90,180,270]){
    for(const moving of [false,true]) {
      const input=buildInputPacket(p,yaw,200n,moving,{pitch:-15});
      const bytes=serializer.createPacketBuffer({name:'player_auth_input',params:input});
      assert.ok(Buffer.isBuffer(bytes)&&bytes.length>16);
    }
  }
});

test('verified movement requires safe 0.6-block footprint, not merely a clear center point',()=>{
  let now=1000,pulse,blocked=false;
  const sent=[];
  const client={queue:(name,p)=>sent.push({name,p})};
  const movement=new ExperimentalPlayerInput(client,true,{
    clock:()=>now,setInterval(cb){pulse=cb;return 1;},clearInterval(){}
  });
  const world={
    closed:false,spawned:true,self:'123',dimension:0,
    position:{x:8.5,y:65.62,z:10.5},yaw:0,pitch:0,
    movementAuthority:1,serverTick:100n,serverTickObservedAt:1000,
    lastServerPositionAt:1000,receivedChunks:new Set(['0,0']),
    terrain:{tile(dim,x,y,z){
      if(blocked&&x===8&&z===10)return 'unknown';
      return 'walkable';
    }}
  };
  assert.equal(movement.runVerifiedStep(world,{x:8.5,y:65.62,z:11.45},8).status,
    'accepted');
  assert.equal(movement.snapshot().motionModel,'verified_flat_footprint');
  blocked=true;
  now+=50;pulse();
  assert.equal(sent.length,0,'unknown body-corner voxel blocks outgoing movement');
  assert.equal(movement.snapshot().stoppedReason,'unverified_or_blocked_next_step');
  assert.equal(movement.snapshot().active,false);
  blocked=false;
  assert.equal(movement.runVerifiedStep(world,{x:8.5,y:65.62,z:11.45},8).status,
    'accepted');
  now+=50;pulse();
  assert.equal(sent.length,1);
  assert.ok(sent[0].p.position.z>10.5);
  assert.ok(sent[0].p.position.z<=10.63);
  assert.equal(sent[0].p.input_data[0],10);
  movement.stop('user_stop',{silent:true});
});
