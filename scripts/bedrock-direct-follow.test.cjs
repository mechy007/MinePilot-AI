'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {BedrockGameplayBridge}=require('./bedrock-gameplay-bridge.cjs');

class Client extends EventEmitter {
  constructor(){super();this.packets=[];}
  queue(name,value){this.packets.push({name,value});}
}
function fixture() {
  const client=new Client();
  let selected=null, enabled=0;
  let allowPlan=true;
  const layerTwo={
    follow(name){
      if(!allowPlan)return {status:'rejected',reason:'target_not_visible'};
      selected=name;
      return {status:'accepted',reason:'follow_plan_only'};
    },
    reset(){},
    snapshot(){return {selected};}
  };
  const autonomy={
    snapshot:()=>({active:false}),
    enable(world,opts){
      enabled++;
      assert.equal(opts.confirmed,true);
      assert.equal(world.spawned,true);
      return {status:'rejected',reason:'start_or_target_not_verified_walkable'};
    },
    stop(){}
  };
  const bridge=new BedrockGameplayBridge(client,{layerTwo,autonomy}).start();
  const run=(extra={})=>bridge.execute({
    version:'minepilot.gameplay.v1',requestId:'follow-test',
    action:'follow_player',playerName:'BuilderFriend',...extra
  });
  return {client,bridge,run,layerTwo,autonomy,
    selection:()=>selected,enableCount:()=>enabled,
    rejectPlan:()=>{allowPlan=false;}
  };
}
test('direct Follow requires explicit confirmation and a joined world',()=>{
  const f=fixture();
  assert.equal(f.run().reason,'confirmation_required');
  assert.equal(f.run({confirmed:true}).reason,'follow_unavailable');
  assert.equal(f.enableCount(),0);
  assert.equal(f.selection(),null);
  f.bridge.stop();
});
test('direct Follow selects a named player once, then delegates to the guarded autonomy runner',()=>{
  const f=fixture();
  f.client.emit('start_game',{
    runtime_entity_id:123n,player_position:{x:8.5,y:64,z:10.5},
    dimension:0,current_tick:100n,movement_authority:1
  });
  f.client.emit('spawn');
  f.client.packets.length=0;
  assert.equal(f.run({confirmed:true}).reason,'start_or_target_not_verified_walkable');
  assert.equal(f.selection(),'BuilderFriend');
  assert.equal(f.enableCount(),1);
  assert.equal(f.client.packets.filter(x=>x.name==='player_auth_input').length,0,
    'a blocked verified path may not issue movement packets');
  f.bridge.stop();
});
test('rejected follow selection never enables physical movement',()=>{
  const f=fixture();
  f.client.emit('start_game',{
    runtime_entity_id:123n,player_position:{x:8.5,y:64,z:10.5},
    dimension:0,current_tick:100n,movement_authority:1
  });
  f.client.emit('spawn');
  f.rejectPlan();
  assert.equal(f.run({confirmed:true}).reason,'target_not_visible');
  assert.equal(f.enableCount(),0);
  f.bridge.stop();
});
