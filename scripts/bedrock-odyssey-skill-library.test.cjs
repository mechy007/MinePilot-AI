'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {CATALOG,evaluateOdysseySkill,listOdysseySkills,summarizeOdysseyLibrary,planOdysseySkill,validateOdysseyCatalog}=require('./bedrock-odyssey-skill-library.cjs');
const allReady={
world_observation:'ready',spatial_observation:'ready',inventory_read:'ready',navigation:'ready',mine:'ready',
eat_food:'ready',combat:'ready',craft:'ready',block_placement:'ready',equip_items:'ready',
collect_resources:'ready',breed_animals:'ready',fishing:'ready',cook:'ready',smelt:'ready',
farming:'ready',shear_animals:'ready',container_transfer:'ready',vehicle_control:'ready'
};
test('imports all 183 upstream compositions as metadata only',()=>{
 assert.equal(validateOdysseyCatalog(),true);assert.equal(CATALOG.compositions.length,183);
 assert.equal(CATALOG.publishedCounts.primitiveSkills,40);assert.equal(CATALOG.publishedCounts.compositionalSkills,183);
 assert.ok(CATALOG.sourceInventory.skillPrimitiveFiles.length>0);
 assert.ok(CATALOG.sourceInventory.controlPrimitiveFiles.length>0);
 assert.ok(CATALOG.sourceInventory.comprehensiveLibraryApiModules.length>0);
 assert.ok(CATALOG.compositions.every(s=>typeof s.id==='string'&&typeof s.description==='string'&&typeof s.sourcePath==='string'&&!Object.hasOwn(s,'code')));
 const diamond=CATALOG.compositions.find(s=>s.id==='mine_diamond');
 assert.ok(diamond.directBotApis.includes('equip'));
 assert.ok(diamond.directBotApis.includes('inventory'));
 assert.ok(diamond.requiredCapabilities.includes('equip_items'));
 assert.ok(diamond.requiredCapabilities.includes('inventory_read'));
});
test('all transitive dependencies resolve and order is acyclic',()=>{
 const ids=new Set(CATALOG.compositions.map(s=>s.id));assert.equal(ids.size,183);
 for(const s of CATALOG.compositions)for(const d of s.dependencies)assert.ok(ids.has(d),d);
 for(const s of CATALOG.compositions){const r=evaluateOdysseySkill(s.id,allReady);assert.deepEqual(r.missingDependencies,[]);assert.deepEqual(r.dependencyCycle,[]);assert.ok(r.dependencyOrder.includes(s.id));}
});
test('family taxonomy covers all 183 skills',()=>{
 const s=summarizeOdysseyLibrary(allReady);assert.equal(s.total,183);
 assert.equal(s.familyCounts.craft,94);assert.equal(s.familyCounts.collect,21);assert.equal(s.familyCounts.mine,14);
 assert.equal(Object.values(s.familyCounts).reduce((a,b)=>a+b,0),183);
});
test('recursive plan includes prerequisites before requested skill',()=>{
 const r=evaluateOdysseySkill('mine_diamond',allReady);assert.equal(r.status,'ready');
 assert.ok(r.dependencyOrder.indexOf('craft_iron_pickaxe')<r.dependencyOrder.indexOf('mine_diamond'));
 assert.ok(r.dependencyOrder.includes('craft_crafting_table'));assert.ok(r.dependencyOrder.includes('smelt_all_raw_iron'));
});
test('one missing prerequisite blocks a composition',()=>{
 const r=evaluateOdysseySkill('mine_diamond',{...allReady,craft:'unsupported'});assert.equal(r.status,'blocked');
 assert.ok(r.blockedCapabilities.some(x=>x.name==='craft'));
});
test('experimental movement and manual mining are not marked ready',()=>{
 const caps={...allReady,navigation:{state:'experimental',reason:'bounded_navigation'},mine:{state:'manual_experimental',reason:'single_block_only'},equip_items:'unsupported'};
 const r=evaluateOdysseySkill('mine_diamond',caps);assert.equal(r.status,'blocked');
 assert.ok(r.partialCapabilities.some(x=>x.name==='navigation'));
 assert.ok(r.manualCapabilities.some(x=>x.name==='mine'));
 assert.ok(r.blockedCapabilities.some(x=>x.name==='equip_items'));
 assert.ok(r.requiredCapabilities.includes('inventory_read'));
});
test('plans are dependency previews and never execute upstream JavaScript',()=>{
 const p=planOdysseySkill('mine_diamond',allReady);assert.equal(p.status,'preview');
 assert.equal(p.execution,'bedrock_action_plan_only');assert.equal(p.executable,false);
 assert.ok(p.bedrockPlan);assert.equal(p.bedrockPlan.executable,false);
 assert.equal(p.arbitraryCodeExecution,false);assert.ok(p.primitiveCalls.includes('mineBlock'));assert.ok(!Object.hasOwn(p,'code'));
 assert.equal(planOdysseySkill('not_a_skill',allReady).status,'rejected');
});
test('listing filters by family, query and compatibility',()=>{
 assert.equal(listOdysseySkills({family:'craft',limit:200}).length,94);
 assert.ok(listOdysseySkills({query:'diamond',limit:20}).some(s=>s.id==='mine_diamond'));
 const blocked=listOdysseySkills({family:'craft',status:'blocked',capabilities:{...allReady,craft:'unsupported'},limit:200});
 assert.equal(blocked.length,94);
});
test('live Bedrock-like states correctly keep unsupported gameplay families blocked',()=>{
 const live={...allReady,navigation:{state:'experimental',reason:'bounded_navigation'},
 mine:{state:'manual_experimental',reason:'single_block_confirmation'},craft:'unsupported',
 equip_items:'unsupported',combat:'unsupported',collect_resources:'unsupported'};
 const s=summarizeOdysseyLibrary(live);assert.equal(s.total,183);assert.equal(s.executableCount,0);
 assert.ok(s.blocked>0);assert.ok(s.partial>0||s.manual>0);
 assert.equal(evaluateOdysseySkill('mine_diamond',live).status,'blocked');
 assert.equal(evaluateOdysseySkill('collect_dirt',live).status,'blocked');
 assert.equal(evaluateOdysseySkill('kill_one_zombie',live).status,'blocked');
});
