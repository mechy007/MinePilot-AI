'use strict';
const {VERSION,TARGET_GAME_VERSION,CODEC_BASELINE}=require('./contracts.cjs');
const {compatibilitySnapshot}=require('./compatibility/versions.cjs');
const {ActionEnvelope}=require('./actions/envelope.cjs');
const {OutcomeVerifier}=require('./actions/outcomes.cjs');
const inventory=require('./inventory/containers.cjs');
const {searchGridAStar}=require('./navigation/astar.cjs');
const {planGoap}=require('./planning/goap.cjs');
const {BedrockObtainPlanner}=require('./planning/obtain.cjs');
const {SurvivalPolicy}=require('./safety/policy.cjs');
const {BoundedTaskRunner}=require('./tasks/runner.cjs');
const {VerifiedCurriculum}=require('./learning/curriculum.cjs');
const {RuntimeRecorder}=require('./diagnostics/recorder.cjs');
function createRuntimeExtensions(options={}){
  const clock=options.clock??Date.now, envelope=new ActionEnvelope(), outcomes=new OutcomeVerifier({clock}), obtain=new BedrockObtainPlanner({clock}), safety=new SurvivalPolicy(), tasks=new BoundedTaskRunner({clock}), curriculum=new VerifiedCurriculum({clock}), recorder=new RuntimeRecorder({clock});
  return {
    envelope,outcomes,obtain,safety,tasks,curriculum,recorder,inventory,
    planObtain:(bridge,item,count)=>obtain.preview(bridge,item,count),
    planGoap:(initial,goal,actions,limits)=>planGoap(initial,goal,actions,limits),
    searchGridAStar,
    recordCommand:(command,result)=>recorder.recordCommand(command,result),
    snapshot:()=>({version:VERSION,targetGameVersion:TARGET_GAME_VERSION,targetVersionVerified:false,codecBaseline:{...CODEC_BASELINE},compatibility:compatibilitySnapshot(),taskRunner:tasks.snapshot(),outcomes:outcomes.snapshot().slice(-16),curriculum:curriculum.snapshot(),diagnostics:{retainedEvents:recorder.events.length,recent:recorder.snapshot(12)},safety:{policy:'observation_only',emitsPackets:false},inventory:{containerAndClickPlans:'preview_only'},planners:{goap:'preview_only',obtain:'preview_only'}}),
    close:(reason='session_closed')=>{tasks.cancel(reason);outcomes.clear();recorder.recordSystem('session_closed',{reason});}
  };
}
module.exports={createRuntimeExtensions};
