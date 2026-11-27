'use strict';
const CAPABILITIES=new Set(['world.observe','world.read','terrain.read','entities.read','inventory.read','session.status']);
const PLUGIN_ID=/^[a-z][a-z0-9-]{1,47}$/;
class ReadOnlyPluginRegistry {
  constructor(options={}) {
    this.maxPlugins=Math.max(1,Math.min(64,options.maxPlugins??24));this.plugins=new Map();
    this.started=false;this.closed=false;this.errors=0;
  }
  register(d) {
    if(this.closed)return {status:'rejected',reason:'registry_closed'};
    if(!d||typeof d!=='object'||!PLUGIN_ID.test(d.id??'')||this.plugins.has(d.id))return {status:'rejected',reason:'invalid_or_duplicate_plugin'};
    if(this.plugins.size>=this.maxPlugins)return {status:'rejected',reason:'plugin_limit_reached'};
    if(typeof d.version!=='string'||!/^\d+\.\d+\.\d+$/.test(d.version)||typeof d.onEvent!=='function')return {status:'rejected',reason:'invalid_plugin_contract'};
    const caps=Array.isArray(d.capabilities)?d.capabilities:[];
    if(caps.length>8||caps.some(v=>!CAPABILITIES.has(v)))return {status:'rejected',reason:'capability_not_allowed'};
    if(d.permissions&&Object.keys(d.permissions).some(k=>k!=='readOnly'))return {status:'rejected',reason:'write_permissions_not_supported'};
    const p={id:d.id,version:d.version,capabilities:[...new Set(caps)],onStart:typeof d.onStart==='function'?d.onStart:null,
      onStop:typeof d.onStop==='function'?d.onStop:null,onEvent:d.onEvent,active:false,errors:0};
    this.plugins.set(p.id,p);if(this.started)this.startOne(p);
    return {status:'registered',id:p.id,readOnly:true};
  }
  startOne(p) {
    if(!p||p.active||this.closed)return;
    try{p.onStart?.(Object.freeze({version:'minepilot.plugin.readonly.v1',capabilities:Object.freeze([...p.capabilities]),readOnly:true}));p.active=true;}
    catch{p.errors++;this.errors++;}
  }
  start(){if(this.closed)return false;this.started=true;for(const p of this.plugins.values())this.startOne(p);return true;}
  publish(event) {
    if(!this.started||this.closed||!event||typeof event.type!=='string')return 0;let count=0;
    for(const p of this.plugins.values())if(p.active){try{p.onEvent(Object.freeze({type:event.type,at:event.at,data:Object.freeze({...event})}));count++;}
      catch{p.errors++;this.errors++;}}
    return count;
  }
  unregister(id){const p=this.plugins.get(id);if(!p)return false;try{p.onStop?.('unregistered');}catch{this.errors++;}this.plugins.delete(id);return true;}
  snapshot(){return {started:this.started,closed:this.closed,readOnly:true,dynamicImports:false,registered:this.plugins.size,
    active:[...this.plugins.values()].filter(p=>p.active).length,errors:this.errors,
    plugins:[...this.plugins.values()].map(p=>({id:p.id,version:p.version,capabilities:[...p.capabilities],active:p.active,errors:p.errors}))};}
  close(reason='session_closed'){if(this.closed)return;this.closed=true;for(const p of this.plugins.values()){try{p.onStop?.(reason);}catch{this.errors++;}p.active=false;}this.plugins.clear();}
}
module.exports={ReadOnlyPluginRegistry,ALLOWED_PLUGIN_CAPABILITIES:[...CAPABILITIES]};
