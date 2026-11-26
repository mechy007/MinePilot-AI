'use strict';
const {plan:bedbooPlan}=require('../../../../vendor/bedboo-agent/planner.cjs');
const {snapshotInventory}=require('../inventory/containers.cjs');
class BedrockObtainPlanner {
  constructor(options={}){this.clock=options.clock??Date.now;this.maxAgeMs=options.maxAgeMs??10000;}
  preview(bridge,item,count=1){
    const blocked=reason=>({status:'blocked',reason,executable:false,steps:[],source:'bedboo_obtain_planner'});
    if(typeof item!=='string'||!/^minecraft:[a-z0-9_./-]{1,80}$/.test(item))return blocked('valid_vanilla_item_required');
    if(!Number.isInteger(count)||count<1||count>64)return blocked('obtain_count_must_be_between_1_and_64');
    if(!bridge||bridge.closed||!bridge.spawned)return blocked('authenticated_bedrock_world_not_ready');
    const inv=snapshotInventory(bridge.inventoryLedger,{maxAgeMs:this.maxAgeMs});if(!inv.known)return blocked(inv.reason);
    const age=this.clock()-inv.observedAt;if(!Number.isFinite(age)||age<0||age>this.maxAgeMs)return blocked('inventory_observation_stale');
    const catalog=bridge.recipeCatalog?.snapshot?.(256);
    if(!catalog||!Number.isFinite(catalog.observedAt)||this.clock()-catalog.observedAt<0||this.clock()-catalog.observedAt>this.maxAgeMs)return blocked('server_recipe_catalog_stale_or_missing');
    const byOutput=new Map();
    for(const r of catalog.recipes??[]){if(r?.supported!==true||typeof r.resultItem!=='string'||!Array.isArray(r.ingredients))continue;if(!byOutput.has(r.resultItem))byOutput.set(r.resultItem,[]);byOutput.get(r.resultItem).push({result:{name:r.resultItem,count:r.resultCount},ingredients:Object.fromEntries(r.ingredients.map(i=>[i.name,i.count])),requiresTable:false,id:r.id});}
    const world={inventory:{...inv.counts},recipes:name=>(byOutput.get(name)??[]).map(r=>({...r,result:{...r.result},ingredients:{...r.ingredients}})),smelting:()=>[],fuels:[],sources:()=>[],mobs:()=>[],stations:{crafting_table:false,furnace:false}};
    const result=bedbooPlan({item,count},world,{maxDepth:12});
    if(!result?.ok)return blocked(result?.reason??'obtain_plan_unavailable');
    return {status:'preview',reason:'dependency_plan_built_from_server_observations',executable:false,source:'bedboo_obtain_planner',item,count,estimatedCost:result.cost,steps:(result.steps??[]).slice(0,64).map(s=>({...s})),inventoryRevision:inv.revision,inventoryGeneration:inv.generation,recipeGeneration:catalog.generation,observedAt:inv.observedAt,note:'Preview only. Gathering, mining, smelting, crafting and inventory changes still require validated Bedrock executors.'};
  }
}
module.exports={BedrockObtainPlanner};
