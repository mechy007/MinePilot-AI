'use strict';
const {VERSION,TARGET_GAME_VERSION,CODEC_BASELINE}=require('./contracts.cjs');
const {compatibilitySnapshot}=require('./compatibility/versions.cjs');
const {detectCompatibility}=require('./compatibility/adapter-selector.cjs');
const {CapabilityRecoveryEngine}=require('./recovery/engine.cjs');
const {StuckRecovery}=require('./navigation/stuck-recovery.cjs');
const {createWorldPerception}=require('./world/perception.cjs');
const {TaskExecutionCoordinator}=require('./tasks/execution-coordinator.cjs');
const {ActionEnvelope}=require('./actions/envelope.cjs');
const {OutcomeVerifier}=require('./actions/outcomes.cjs');
const inventory=require('./inventory/containers.cjs');
const {searchGridAStar}=require('./navigation/astar.cjs');
const {searchVoxelAStar}=require('./navigation/voxel.cjs');
const {planLocalRoute}=require('../../bedrock-local-path.cjs');
const navigationGoals=require('./navigation/goals.cjs');
const navigationCosts=require('./navigation/costs.cjs');
const {planGoap}=require('./planning/goap.cjs');
const {BedrockObtainPlanner}=require('./planning/obtain.cjs');
const {SurvivalPolicy}=require('./safety/policy.cjs');
const {BoundedTaskRunner}=require('./tasks/runner.cjs');
const {VerifiedCurriculum}=require('./learning/curriculum.cjs');
const {RuntimeRecorder}=require('./diagnostics/recorder.cjs');
const {RuntimeEventBus}=require('./events/event-bus.cjs');
const {normalizePacket}=require('./adapters/packet-normalizer.cjs');
const {WorldKnowledgeStore}=require('./world/knowledge-store.cjs');
const registryAdapter=require('./registry/adapter.cjs');
const {ReadOnlyPluginRegistry}=require('./plugins/registry.cjs');
const protocol=require('./protocol/differential.cjs');
const {sourceCatalog}=require('./sources/catalog.cjs');
function createRuntimeExtensions(options={}) {
 const clock=options.clock??Date.now;
 const envelope=new ActionEnvelope(),outcomes=new OutcomeVerifier({clock}),obtain=new BedrockObtainPlanner({clock});
 const safety=new SurvivalPolicy(),tasks=new BoundedTaskRunner({clock}),curriculum=new VerifiedCurriculum({clock});
 const recorder=new RuntimeRecorder({clock}),events=new RuntimeEventBus({clock});
 const world=new WorldKnowledgeStore({clock,...(options.worldLimits??{})});
 const capabilities=new CapabilityRecoveryEngine({clock}),stuckRecovery=new StuckRecovery({clock}),perception=createWorldPerception(world,{clock});
 const taskExecution=new TaskExecutionCoordinator({runner:tasks,capabilities,adapter:options.taskAdapter});
 const plugins=new ReadOnlyPluginRegistry(options.pluginLimits);
 let lastCapabilityAssessment=null,lastStuckAssessment=null,lastCorrectionCount=0;
 let lastWorldAwareness=null,lastWorldAwarenessAt=0;
 function observeBridge(bridge) {
  if(closed||!bridge)return null;
  const movement=bridge.movement?.snapshot?.()??{};
  const movementCapability=bridge.movement?.capability?.(bridge)??'unavailable';
  const terrain=bridge.terrain?.snapshot?.()??{};
  const inventory=bridge.inventoryLedger?.playerInventory?.({maxAgeMs:10000})??{};
  const recipes=bridge.recipeCatalog?.snapshot?.(1)??{};
  lastCapabilityAssessment=capabilities.assess({
   sessionOpen:bridge.closed!==true,spawned:bridge.spawned===true,
   movementCapability,
   terrainReady:movementCapability==='ready'&&terrain.decodedSections>0&&terrain.collisionClassificationReady===true,
   inventoryFresh:inventory.known===true&&inventory.fresh===true&&inventory.fullSnapshotFresh===true&&
    inventory.registryKnown===true&&inventory.unresolvedItemCount===0,
   recipeCatalogFresh:recipes.observedAt!==null&&Number.isFinite(recipes.ageMs)&&recipes.ageMs<=30000
  });
  const now=clock();
  if(!lastWorldAwareness||now-lastWorldAwarenessAt>=500){
   lastWorldAwareness=perception.snapshot({position:bridge.position,dimension:bridge.dimension,terrain:bridge.terrain,radius:4});
   lastWorldAwarenessAt=now;
  }
  const correctionCount=Number.isInteger(movement.corrections)?movement.corrections:0;
  const serverCorrected=correctionCount>lastCorrectionCount;
  lastCorrectionCount=correctionCount;
  lastStuckAssessment=stuckRecovery.observe({
   at:clock(),position:bridge.position??movement.predictedPosition,
   inputActive:movement.active===true,serverCorrected,teleport:false
  });
  return {capabilities:lastCapabilityAssessment,stuckRecovery:lastStuckAssessment,worldAwareness:lastWorldAwareness};
 }
 let closed=false;plugins.start();
 function observePacket(name,packet,bridge) {
  if(closed)return null;
  const projection=normalizePacket(name,packet,bridge,clock());
  if(!projection)return null;
  world.apply(projection);events.emit(projection.type,projection);plugins.publish(projection);
  return projection;
 }
 function planTerrainRoute(bridge,args={}) {
  const terrain=bridge?.terrain,dimension=Number.isInteger(args.dimension)?args.dimension:bridge?.dimension;
  if(!terrain||typeof terrain.tile!=='function'||typeof terrain.snapshot!=='function'||
    !Number.isInteger(dimension)||dimension<0||dimension>2)
    return {status:'unverified',reason:'minepilot_verified_terrain_unavailable',path:[],cost:null,expanded:0,executable:false};
  const snapshot=terrain.snapshot();
  if(snapshot?.collisionClassificationReady!==true)
    return {status:'unverified',reason:'collision_registry_not_verified',path:[],cost:null,expanded:0,executable:false};
  const target=args.target??args.goal?.position??args.goal;
  const route=planLocalRoute(terrain,dimension,args.start,target,{
   radius:args.radius,verticalRadius:args.verticalRadius,maxExpanded:args.maxExpanded,maxPathLength:args.maxPath
  });
  return route.status==='route_found'
   ?{status:'preview',reason:route.reason,path:route.path,cost:route.cost,expanded:route.expanded,
     executable:false,waypoint:route.waypoint,jump:route.jump,waypointMode:route.waypointMode}
   :{status:'unverified',reason:route.reason,path:[],cost:null,expanded:route.expanded,executable:false};
 }
 return {
  envelope,outcomes,obtain,safety,tasks,curriculum,recorder,inventory,capabilities,stuckRecovery,perception,taskExecution,
  detectCompatibility,
  events,world,plugins,registryAdapter,protocol,navigationGoals,navigationCosts,
  observeMovementSample:(sample)=>stuckRecovery.observe(sample),
  observeBridge,
  planObtain:(bridge,item,count)=>obtain.preview(bridge,item,count),
  planGoap:(initial,goal,actions,limits)=>planGoap(initial,goal,actions,limits),
  searchGridAStar,searchVoxelAStar,planTerrainRoute,observePacket,
  recordCommand:(command,result)=>recorder.recordCommand(command,result),
  recordSystem:(event,details)=>recorder.recordSystem(event,details),
  sourceCatalog,
  snapshot:()=>({
   version:VERSION,targetGameVersion:TARGET_GAME_VERSION,targetVersionVerified:false,
   codecBaseline:{...CODEC_BASELINE},compatibility:compatibilitySnapshot(),
   taskRunner:tasks.snapshot(),capabilities:capabilities.snapshot(),
   capabilityAssessment:lastCapabilityAssessment??capabilities.assess({}),
   stuckRecovery:{...stuckRecovery.snapshot(),lastAssessment:lastStuckAssessment},
   worldAwareness:lastWorldAwareness,
   taskExecution:{configured:!!options.taskAdapter,runner:tasks.snapshot()},
   compatibilityDetection:detectCompatibility({gameVersion:options.gameVersion,protocol:options.protocol}),outcomes:outcomes.snapshot().slice(-16),curriculum:curriculum.snapshot(),
   diagnostics:{retainedEvents:recorder.events.length,recent:recorder.snapshot(12)},
   safety:{policy:'observation_only',emitsPackets:false},
   inventory:{containerAndClickPlans:'preview_only'},
   planners:{gridAStar:'preview_only',voxelAStar:'preview_only',terrainRoute:'preview_only',goap:'preview_only',obtain:'preview_only'},
   integrations:{events:events.snapshot(),world:world.snapshot(),plugins:plugins.snapshot(),
    sources:sourceCatalog().length,protocolComparison:'fixture_only_no_live_codec_override',
    externalRegistries:'cross_check_only'}
  }),
  close:(reason='session_closed')=>{
   if(closed)return;closed=true;tasks.cancel(reason);stuckRecovery.reset();capabilities.reset();outcomes.clear();
   plugins.close(reason);events.close();world.close();lastCapabilityAssessment=null;lastStuckAssessment=null;
   lastWorldAwareness=null;lastWorldAwarenessAt=0;recorder.recordSystem('session_closed',{reason});
  }
 };
}
module.exports={createRuntimeExtensions};
