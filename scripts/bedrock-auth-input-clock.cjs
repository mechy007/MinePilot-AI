'use strict';

/**
 * Protocol 2225 (Bedrock 1.26.60 through 1.26.66) PlayerAuthInput tick clock.
 *
 * The server associates input ticks with its rewind window. Scheduling jitter
 * must not slow the client simulation clock to the timer callback rate.
 *
 * One shared clock is owned by the authenticated client's SINGLE input writer
 * (neutral presence, bounded movement, block action and neutral stop frames).
 * All numeric input ticks are BigInt until the protocol serializer handles them.
 */
const TICK_MS=50;
const MAX_TICK=18446744073709551615n;
const MAX_ACK_AGE=128n;
const valid=t=>typeof t==='bigint' && t>=0n && t<MAX_TICK-10000n;
class AuthInputTickClock {
  constructor(options={}) {
    this.clock=options.clock??Date.now;
    this.reset();
  }
  reset(){
    this.anchorTick=null;this.anchorTime=null;
    this.lastTick=null;this.lastAck=null;
    this.skippedTicks=0;this.observedCorrections=0;
    this.rejectedCorrections=0;
  }
  seed(tick,observedAt=this.clock()) {
    if(!valid(tick)||!Number.isFinite(observedAt))return false;
    if(this.anchorTick!==null)return true;
    this.anchorTick=tick;
    this.anchorTime=observedAt;
    return true;
  }
  next(){
    if(this.anchorTick===null)throw new Error('authoritative_tick_not_seeded');
    const now=this.clock();
    const elapsed=Math.max(0,Math.floor((now-this.anchorTime)/TICK_MS));
    let tick=this.anchorTick+BigInt(Math.max(1,elapsed));
    if(this.lastTick!==null){
      if(tick<=this.lastTick)tick=this.lastTick+1n;
      const gap=tick-this.lastTick;
      if(gap>1n)this.skippedTicks+=Math.min(100000,Number(gap-1n));
    }
    if(!valid(tick))throw new Error('authoritative_tick_out_of_range');
    this.lastTick=tick;
    return tick;
  }
  correction(tick){
    if(!valid(tick)){this.rejectedCorrections++;return false;}
    const now=this.clock();
    // Corrections refer to past client-sent input ticks. Never move the
    // monotonic writer backwards and never re-anchor to very old packets.
    if(this.lastTick!==null && tick+MAX_ACK_AGE<this.lastTick){
      this.rejectedCorrections++;return false;
    }
    if(this.lastAck!==null && tick<this.lastAck){
      this.rejectedCorrections++;return false;
    }
    this.lastAck=tick;this.observedCorrections++;
    const remaining=this.lastTick!==null&&this.lastTick>tick
      ? Math.min(Number(this.lastTick-tick),40):0;
    // Account for already-sent frames; a server correction isn't a new
    // current-tick source and must not rewind the outgoing stream.
    this.anchorTick=tick;
    this.anchorTime=now-remaining*TICK_MS;
    return true;
  }
  snapshot(){
    return {
      protocol:2225,mode:'wall_clock_server_anchored',
      lastTick:this.lastTick===null?null:this.lastTick.toString(),
      lastAck:this.lastAck===null?null:this.lastAck.toString(),
      skippedTicks:this.skippedTicks,
      observedCorrections:this.observedCorrections,
      rejectedCorrections:this.rejectedCorrections
    };
  }
}
module.exports={AuthInputTickClock,TICK_MS};
