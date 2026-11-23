'use strict';

/**
 * Bedrock 1.26.60 server-authoritative block-action controller.
 * Uses the *existing* player_auth_input tick stream (InputData block_action=35).
 * Never sends an independent tick stream or claims that a packet equals a mine.
 *
 * Initial use requires an explicit, confirmed user command and a fully known,
 * nearby, breakable block. Only the server's update_block response can mark
 * a changed block, and other players can also cause that update.
 */
const MAX_CONTINUE = 24; // at 20Hz, 1.2 seconds for basic test blocks
const MAX_ACTION_MS = 6000;
const MAX_REACH = 4.5;
function validBlock(v) {
  return v&&typeof v==='object'&&['x','y','z'].every(k=>
    Number.isInteger(v[k]) && Math.abs(v[k])<=30000000);
}
const key=p=>p.x+','+p.y+','+p.z;
class BedrockBlockBreakExecutor {
  constructor(options={}) {
    this.clock=options.clock??Date.now;
    this.active=null;
    this.last={status:'idle',reason:'idle',frames:0,serverObserved:false,
      serverChanged:false,target:null};
  }
  start(world,position,confirmed) {
    if(confirmed!==true)return {status:'rejected',reason:'confirmation_required'};
    if(this.active)return {status:'rejected',reason:'block_action_busy'};
    if(world?.closed || !world?.spawned || !world?.position ||
       world.gameplayWorld?.().safetyHold)
      return {status:'rejected',reason:'world_not_safe'};
    if(!validBlock(position)||!world.terrain||world.dimension==null)
      return {status:'rejected',reason:'block_target_unavailable'};
    const dist=Math.hypot(position.x+.5-world.position.x,
      position.y+.5-world.position.y,position.z+.5-world.position.z);
    if(!Number.isFinite(dist)||dist>MAX_REACH)
      return {status:'rejected',reason:'target_out_of_reach'};
    const name=world.terrain.blockName(world.dimension,
      position.x,position.y,position.z);
    const kind=world.terrain.kind(world.dimension,
      position.x,position.y,position.z);
    if(!name||kind!=='solid'||name==='minecraft:bedrock'||
       name==='minecraft:barrier'||name==='minecraft:command_block')
      return {status:'rejected',reason:'target_not_verified_breakable'};
    const runtimeId=world.terrain.blockId(world.dimension,
      position.x,position.y,position.z);
    if(!Number.isInteger(runtimeId))return {status:'rejected',reason:'block_id_unavailable'};
    if(world.movement?.snapshot()?.active)
      return {status:'rejected',reason:'movement_busy'};
    if(!world.movement?.snapshot()?.presenceActive)
      return {status:'rejected',reason:'player_presence_unavailable'};
    this.active={position:{...position},runtimeId,dimension:world.dimension,
      start:this.clock(),phase:'start',sent:0,continued:0};
    this.last={status:'in_progress',reason:'bounded_break_started_not_verified',
      frames:0,serverObserved:false,serverChanged:false,target:{...position}};
    return {status:'accepted',reason:'block_action_queued_not_verified'};
  }
  next(world) {
    const a=this.active;
    if(!a)return null;
    if(!world || world.closed || !world.spawned ||
       world.dimension!==a.dimension ||
       world.gameplayWorld?.().safetyHold ||
       this.clock()-a.start>MAX_ACTION_MS){
      this.abort('session_or_safety_changed');
      return null;
    }
    const common={position:{...a.position},face:1};
    let action;
    if(a.phase==='start'){action={action:'start_break',...common};a.phase='continue';}
    else if(a.phase==='continue'){
      if(a.continued>=MAX_CONTINUE){a.phase='stop';}
      else{action={action:'continue_break',...common};a.continued++;}
    }
    if(a.phase==='stop'){
      action={action:'stop_break',...common};a.phase='waiting_for_server';
    }
    if(action){a.sent++;this.last.frames=a.sent;}
    return action??null;
  }
  observedBlock(packet,dimension) {
    const a=this.active;
    if(!a||a.sent===0 ||
       dimension!==a.dimension||!validBlock(packet?.position) ||
       key(packet.position)!==key(a.position))return;
    const id=packet.block_runtime_id;
    if(!Number.isInteger(id)||id===a.runtimeId)return;
    this.active=null;
    this.last.status='observed';
    this.last.reason='server_block_changed_causality_unverified';
    this.last.serverObserved=true;
    this.last.serverChanged=true;
  }
  pulseTimeout() {
    const a=this.active;
    if(a?.phase==='waiting_for_server'&&this.clock()-a.start>MAX_ACTION_MS)
      this.abort('server_block_update_missing');
  }
  abort(reason='user_stopped') {
    if(!this.active)return;
    this.active=null;
    this.last.status='stopped';
    this.last.reason=reason;
  }
  snapshot() {return {...this.last,active:this.active!=null,phase:this.active?.phase??'idle'};}
}
module.exports={BedrockBlockBreakExecutor};
