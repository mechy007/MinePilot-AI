'use strict';

// Bedrock-safe metadata bridge. Upstream Mineflayer source is never loaded.
const CATALOG = require('./bedrock-odyssey-skill-catalog.json');
const { buildBedrockPrimitivePlan, evaluatePrimitive, validatePrimitiveCoverage } = require('./bedrock-odyssey-bedrock-adapter.cjs');
const BY_ID = new Map(CATALOG.compositions.map(skill => [skill.id, skill]));
const ALLOWED_STATES = new Set(['ready','experimental','partial','manual_experimental','unsupported','preview_only','protocol_only','blocked']);

function stateOf(capabilities, name) {
  const value = capabilities?.[name];
  const state = typeof value === 'string' ? value : value?.state;
  return ALLOWED_STATES.has(state) ? state : 'blocked';
}
function reasonOf(capabilities, name) {
  const value = capabilities?.[name];
  return typeof value === 'object' && typeof value?.reason === 'string'
    ? value.reason.slice(0, 96) : 'capability_not_advertised';
}
function dependencyClosure(skillId) {
  const order = [], missing = [], cycle = [], marks = new Map();
  function visit(id) {
    if (marks.get(id) === 2) return;
    if (marks.get(id) === 1) { cycle.push(id); return; }
    const skill = BY_ID.get(id);
    if (!skill) { missing.push(id); return; }
    marks.set(id, 1);
    for (const dependency of skill.dependencies) visit(dependency);
    marks.set(id, 2);
    order.push(id);
  }
  visit(skillId);
  return { order, missing: [...new Set(missing)], cycle: [...new Set(cycle)] };
}
function evaluateOdysseySkill(skillId, capabilities = {}) {
  const skill = BY_ID.get(skillId);
  if (!skill) return { id: skillId, status: 'blocked', reason: 'unknown_odyssey_skill', executable: false };
  const closure = dependencyClosure(skillId), required = new Set();
  for (const id of closure.order)
    for (const capability of BY_ID.get(id)?.requiredCapabilities ?? []) required.add(capability);
  const states = [...required].sort().map(name => ({name,state:stateOf(capabilities,name),reason:reasonOf(capabilities,name)}));
  const primitiveCalls = [...new Set(closure.order.flatMap(id => BY_ID.get(id)?.primitiveCalls ?? []))].sort();
  const primitiveStates = primitiveCalls.map(name => evaluatePrimitive(name, capabilities));
  const blocked = states.filter(item => !['ready','experimental','partial','manual_experimental'].includes(item.state));
  const partial = states.filter(item => ['experimental','partial'].includes(item.state));
  const manual = states.filter(item => item.state === 'manual_experimental');
  const blockedPrimitives = primitiveStates.filter(item => item.status === 'blocked');
  const partialPrimitives = primitiveStates.filter(item => item.status === 'partial');
  const manualPrimitives = primitiveStates.filter(item => item.status === 'manual');
  let status = 'ready';
  if (closure.missing.length || closure.cycle.length || blocked.length || blockedPrimitives.length) status = 'blocked';
  else if (partial.length || partialPrimitives.length) status = 'partial';
  else if (manual.length || manualPrimitives.length) status = 'manual';
  if (!closure.order.length) status = 'blocked';
  return {
    id:skill.id,upstreamName:skill.upstreamName,family:skill.family,status,
    dependencyOrder:closure.order,missingDependencies:closure.missing,dependencyCycle:closure.cycle,
    requiredCapabilities:[...required].sort(),primitiveCalls,blockedCapabilities:blocked,
    partialCapabilities:partial,manualCapabilities:manual,blockedPrimitives,partialPrimitives,manualPrimitives,executable:false,
    reason:status==='ready'?'catalog_prerequisites_ready_but_no_odyssey_executor_is_connected'
      :status==='partial'?'one_or_more_bedrock_capabilities_are_experimental'
      :status==='manual'?'one_or_more_bedrock_capabilities_require_user_confirmation'
      :'one_or_more_bedrock_capabilities_or_dependencies_are_unavailable'
  };
}
function listOdysseySkills(options = {}) {
  const query = typeof options.query === 'string' ? options.query.trim().toLowerCase() : '';
  const family = typeof options.family === 'string' ? options.family : null;
  const capabilities = options.capabilities ?? {};
  const limit = Number.isInteger(options.limit) ? Math.max(1,Math.min(183,options.limit)) : 183;
  return CATALOG.compositions.filter(skill =>
    (!family || skill.family === family) &&
    (!query || skill.id.includes(query) || skill.upstreamName.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query))
  ).map(skill => ({...skill,compatibility:evaluateOdysseySkill(skill.id,capabilities)}))
    .filter(skill => !options.status || skill.compatibility.status === options.status).slice(0,limit);
}
function summarizeOdysseyLibrary(capabilities = {}) {
  const counts = {ready:0,partial:0,manual:0,blocked:0};
  for (const skill of CATALOG.compositions) {
    const status=evaluateOdysseySkill(skill.id,capabilities).status;
    counts[status]=(counts[status]??0)+1;
  }
  return {
    version:CATALOG.schemaVersion,upstreamCommit:CATALOG.upstream.commit,
    total:CATALOG.compositions.length,primitiveSkills:CATALOG.publishedCounts.primitiveSkills,
    compositionalSkills:CATALOG.publishedCounts.compositionalSkills,...counts,
    familyCounts:{...CATALOG.familyCounts},executableCount:0,
    executionMode:'metadata_planning_only_no_mineflayer_executor'
  };
}
function planOdysseySkill(skillId, capabilities = {}) {
  const compatibility=evaluateOdysseySkill(skillId,capabilities),skill=BY_ID.get(skillId);
  if(!skill)return {status:'rejected',reason:compatibility.reason,execution:'bedrock_action_plan_only',
    executable:false,arbitraryCodeExecution:false,compatibility};
  return {
    status:compatibility.status==='blocked'?'blocked':'preview',reason:compatibility.reason,
    skillId,title:skill.upstreamName,dependencyOrder:compatibility.dependencyOrder,
    primitiveCalls:compatibility.primitiveCalls,
    requiredCapabilities:compatibility.requiredCapabilities,
    bedrockPlan:buildBedrockPrimitivePlan({...skill,primitiveCalls:compatibility.primitiveCalls}, capabilities),
    execution:'bedrock_action_plan_only',executable:false,arbitraryCodeExecution:false,compatibility
  };
}
function validateOdysseyCatalog() {
  const ids=new Set();
  for(const skill of CATALOG.compositions){
    if(!skill||typeof skill.id!=='string'||ids.has(skill.id))return false;
    ids.add(skill.id);
    if(!Array.isArray(skill.dependencies)||!Array.isArray(skill.requiredCapabilities)||
       !Array.isArray(skill.primitiveCalls)||typeof skill.description!=='string'||
       typeof skill.sourcePath!=='string'||Object.hasOwn(skill,'code'))return false;
    if(skill.dependencies.some(id=>!BY_ID.has(id)))return false;
  }
  return ids.size===CATALOG.publishedCounts.compositionalSkills && validatePrimitiveCoverage(CATALOG);
}
if(!validateOdysseyCatalog())throw new Error('ODYSSEY metadata catalog validation failed');
module.exports={CATALOG,evaluateOdysseySkill,listOdysseySkills,summarizeOdysseyLibrary,planOdysseySkill,validateOdysseyCatalog};
