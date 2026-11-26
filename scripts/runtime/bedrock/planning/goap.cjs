'use strict';
function plain(o){return o!==null&&typeof o==='object'&&!Array.isArray(o);}
function stateKey(s){return JSON.stringify(Object.keys(s).sort().map(k=>[k,s[k]]));}
function matches(s,c){return Object.entries(c??{}).every(([k,v])=>s[k]===v);}
function planGoap(initial,goal,actions,options={}){
  if(!plain(initial)||!plain(goal)||!Array.isArray(actions))return {status:'rejected',reason:'invalid_goap_input',executable:false};
  const maxExpanded=Math.max(1,Math.min(2048,options.maxExpanded??512)),maxDepth=Math.max(1,Math.min(24,options.maxDepth??12));
  const valid=actions.filter(a=>a&&typeof a.id==='string'&&a.id.length<=80&&plain(a.preconditions)&&plain(a.effects)&&Number.isFinite(a.cost)&&a.cost>0);
  const open=[{state:{...initial},steps:[],cost:0,score:0}],best=new Map([[stateKey(initial),0]]);let expanded=0;
  while(open.length&&expanded<maxExpanded){open.sort((a,b)=>a.score-b.score||a.cost-b.cost||a.steps.length-b.steps.length);const n=open.shift(),k=stateKey(n.state);if(n.cost!==best.get(k))continue;expanded++;
    if(matches(n.state,goal))return {status:'preview',reason:'goal_plan_found',executable:false,steps:n.steps,finalState:n.state,cost:n.cost,expanded};
    if(n.steps.length>=maxDepth)continue;
    for(const a of valid){if(!matches(n.state,a.preconditions))continue;const next={...n.state,...a.effects},nk=stateKey(next),cost=n.cost+a.cost;if(cost>=(best.get(nk)??Infinity))continue;best.set(nk,cost);open.push({state:next,steps:[...n.steps,{id:a.id,intent:a.intent?structuredClone(a.intent):null,requiresConfirmation:a.requiresConfirmation!==false}],cost,score:cost+Object.entries(goal).filter(([key,value])=>next[key]!==value).length*2});}
  }
  return {status:'blocked',reason:expanded>=maxExpanded?'goap_search_budget_exhausted':'no_plan_from_observed_state',executable:false,steps:[],expanded};
}
module.exports={planGoap,stateKey,matches};
