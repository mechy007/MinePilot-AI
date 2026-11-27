'use strict';
const DEFAULTS = Object.freeze({ walk:1,water:4,climb:5,jump:6,fall:2,hazard:Infinity,unknown:Infinity });
function estimateStepCost(step,options={}) {
  const costs={...DEFAULTS,...(options.costs??{})};
  if(!step||typeof step!=='object'||step.verified!==true)return Infinity;
  const base=costs[step.mode??'walk']; if(!Number.isFinite(base)||base<0)return Infinity;
  const bounded=(v,max)=>Number.isFinite(v)?Math.max(0,Math.min(max,v)):0;
  return base+bounded(step.toolDurabilityCost,1000)*0.05+bounded(step.hungerCost,100)*0.2+bounded(step.riskCost,10000);
}
function fallTimeCost(blocks,gravity=0.08,terminalVelocity=3.92) {
  if(!Number.isFinite(blocks)||blocks<0||blocks>4096||!Number.isFinite(gravity)||gravity<=0||gravity>1||
    !Number.isFinite(terminalVelocity)||terminalVelocity<=0||terminalVelocity>20)return Infinity;
  let remaining=blocks,velocity=0,ticks=0;
  while(remaining>0&&ticks<2000){velocity=Math.min(terminalVelocity,velocity+gravity);remaining-=velocity;ticks++;}
  return remaining<=0?ticks:Infinity;
}
module.exports={DEFAULT_MOVEMENT_COSTS:DEFAULTS,estimateStepCost,fallTimeCost};
