'use strict';
const valid = value => value && ['x','y','z'].every(key => Number.isSafeInteger(value[key]) && Math.abs(value[key]) <= 30_000_000);
class GoalBlock {
  constructor(x,y,z) { this.position = { x:Math.floor(x), y:Math.floor(y), z:Math.floor(z) }; }
  isEnd(n) { return valid(n) && n.x===this.position.x && n.y===this.position.y && n.z===this.position.z; }
  heuristic(n) { return Math.abs(n.x-this.position.x)+Math.abs(n.y-this.position.y)+Math.abs(n.z-this.position.z); }
}
class GoalNear {
  constructor(x,y,z,range=1) { this.position={x,y,z}; this.range=Number.isFinite(range)?Math.max(0,Math.min(64,range)):1; }
  isEnd(n) { return valid(n) && Math.hypot(n.x-this.position.x,n.y-this.position.y,n.z-this.position.z)<=this.range; }
  heuristic(n) { return Math.max(0,Math.hypot(n.x-this.position.x,n.y-this.position.y,n.z-this.position.z)-this.range); }
}
class GoalXZ {
  constructor(x,z) { this.x=Math.floor(x); this.z=Math.floor(z); }
  isEnd(n) { return valid(n) && n.x===this.x && n.z===this.z; }
  heuristic(n) { return Math.abs(n.x-this.x)+Math.abs(n.z-this.z); }
}
class GoalFollow {
  constructor(entityId,positionProvider,range=2) { this.entityId=String(entityId); this.positionProvider=positionProvider; this.range=Number.isFinite(range)?Math.max(0,Math.min(32,range)):2; }
  current() { if(typeof this.positionProvider!=='function')return null; const p=this.positionProvider(this.entityId); return valid(p)?p:null; }
  isEnd(n) { const t=this.current(); return !!t && valid(n) && Math.hypot(n.x-t.x,n.y-t.y,n.z-t.z)<=this.range; }
  heuristic(n) { const t=this.current(); return t&&valid(n)?Math.max(0,Math.hypot(n.x-t.x,n.y-t.y,n.z-t.z)-this.range):Infinity; }
}
module.exports = { GoalBlock,GoalNear,GoalXZ,GoalFollow,validGoalPosition:valid };
