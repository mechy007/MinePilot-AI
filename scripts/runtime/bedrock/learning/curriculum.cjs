'use strict';
const DEFAULT_SKILLS=Object.freeze([
  {id:'inspect_world',requires:[],category:'observation'},
  {id:'follow_selected_player',requires:['inspect_world'],category:'navigation'},
  {id:'return_to_home',requires:['inspect_world'],category:'navigation'},
  {id:'collect_observed_drop',requires:['inspect_world'],category:'gathering'},
  {id:'obtain_item',requires:['collect_observed_drop'],category:'planning'},
  {id:'survival_routine',requires:['inspect_world','return_to_home'],category:'survival'}
]);
class VerifiedCurriculum {
  constructor(options={}){this.clock=options.clock??Date.now;this.skills=options.skills??DEFAULT_SKILLS;this.results=new Map();this.history=[];this.maxHistory=options.maxHistory??64;}
  recordOutcome(id,outcome){if(!this.skills.some(s=>s.id===id))return {status:'rejected',reason:'unknown_skill'};if(outcome?.status!=='succeeded'||outcome.serverObservedSuccess!==true)return {status:'ignored',reason:'only_server_verified_success_counts_as_learning'};const n=(this.results.get(id)??0)+1;this.results.set(id,n);this.history.push({skillId:id,at:this.clock(),outcome:'server_verified'});while(this.history.length>this.maxHistory)this.history.shift();return {status:'recorded',skillId:id,verifiedCount:n};}
  nextProposal(){const s=this.skills.find(x=>!this.results.has(x.id)&&x.requires.every(id=>(this.results.get(id)??0)>0));return s?{status:'proposal',skillId:s.id,category:s.category,requiresConfirmation:true,autoStart:false,execution:'not_started'}:{status:'none',reason:'no_uncompleted_skill_with_verified_prerequisites'};}
  snapshot(){return {completedSkills:[...this.results.keys()],verifiedRuns:Object.fromEntries(this.results),next:this.nextProposal(),history:this.history.map(x=>({...x})),autoStart:false};}
  reset(){this.results.clear();this.history=[];}
}
module.exports={VerifiedCurriculum,DEFAULT_SKILLS};
