'use strict';
const REQUIRED=Object.freeze(['session','spawn','movement','terrain','inventory','recipeCatalog']);
class CapabilityRecoveryEngine {
 constructor(options={}){this.clock=options.clock??Date.now;this.maxAttempts=Math.max(1,Math.min(5,options.maxAttempts??3));this.cooldownMs=Math.max(250,Math.min(30000,options.cooldownMs??1500));this.attempts=new Map();}
 assess(snapshot={}) {
  const checks={
   session:snapshot.sessionOpen===true,spawn:snapshot.spawned===true,
   movement:snapshot.movementCapability==='ready',
   terrain:snapshot.terrainReady===true,
   inventory:snapshot.inventoryFresh===true,
   recipeCatalog:snapshot.recipeCatalogFresh===true
  };
  const missing=REQUIRED.filter(k=>!checks[k]);
  return {status:missing.length?'degraded':'ready',checks,missing,canExecute:missing.length===0,
   reason:missing.length?'required_capabilities_unavailable':'all_required_capabilities_ready'};
 }
 choose(snapshot={},strategies=[]) {
  const assessment=this.assess(snapshot);
  const candidates=Array.isArray(strategies)?strategies.slice(0,8):[];
  const selected=candidates.find(s=>s&&typeof s.id==='string'&&typeof s.run==='function'&&
   s.requires?.every(k=>assessment.checks[k]===true));
  return {assessment,strategy:selected?.id??null,executable:!!selected,
   reason:selected?'compatible_strategy_selected':'no_safe_strategy_available'};
 }
 recordAttempt(key,result) {
  const id=String(key).slice(0,96),now=this.clock(),old=this.attempts.get(id)??{count:0,lastAt:0};
  const next={count:old.count+1,lastAt:now,lastStatus:String(result?.status??'unknown').slice(0,32)};
  this.attempts.set(id,next);return {...next,allowed:next.count<=this.maxAttempts&&now-old.lastAt>=this.cooldownMs};
 }
 reset(key){if(key==null)this.attempts.clear();else this.attempts.delete(String(key));}
 snapshot(){return {required:REQUIRED.slice(),trackedRecoveries:this.attempts.size,maxAttempts:this.maxAttempts,cooldownMs:this.cooldownMs};}
}
module.exports={CapabilityRecoveryEngine,REQUIRED};
