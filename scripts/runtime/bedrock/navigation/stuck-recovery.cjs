'use strict';
class StuckRecovery {
 constructor(options={}){this.clock=options.clock??Date.now;this.windowMs=Math.max(1000,Math.min(30000,options.windowMs??5000));this.threshold=Math.max(2,Math.min(20,options.threshold??5));this.minProgress=Math.max(0.01,Math.min(1,options.minProgress??0.12));this.samples=[];this.recoveryCount=0;this.lastRecoveryAt=null;}
 observe(sample={}) {
  const now=Number.isFinite(sample.at)?sample.at:this.clock(),p=sample.position;
  if(!p||!['x','y','z'].every(k=>Number.isFinite(p[k]))||sample.inputActive!==true||sample.serverCorrected===true||sample.teleport===true){this.reset();return {stuck:false,reason:'sample_not_eligible'};}
  this.samples.push({at:now,x:p.x,y:p.y,z:p.z});this.samples=this.samples.filter(s=>now-s.at<=this.windowMs).slice(-this.threshold*2);
  if(this.samples.length<this.threshold)return {stuck:false,reason:'insufficient_samples',samples:this.samples.length};
  const first=this.samples[0],last=this.samples[this.samples.length-1],progress=Math.hypot(last.x-first.x,last.z-first.z);
  if(progress>=this.minProgress)return {stuck:false,reason:'progress_detected',progress};
  return {stuck:true,reason:'movement_input_without_server_progress',progress,suggestedRecovery:'stop_reorient_repath',executable:false};
 }
 markRecovery(){this.recoveryCount++;this.lastRecoveryAt=this.clock();this.reset();}
 reset(){this.samples=[];}
 snapshot(){return {samples:this.samples.length,recoveryCount:this.recoveryCount,lastRecoveryAt:this.lastRecoveryAt,automaticMovementMutation:false};}
}
module.exports={StuckRecovery};
