'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {VoyagerLearningCore,safeSkillRecord,gameplaySkillManifest}=require('./bedrock-skill-manifest.cjs');

function worldFixture(){
  let now=1000;
  const world={
    commandPath:null,clock:()=>now,closed:false,spawned:true,
    position:{x:1,y:64,z:1},dimension:0,lastServerPositionAt:now,
    movementAuthority:1,
    terrain:{snapshot:()=>({collisionClassificationReady:true})},
    movement:{capability:()=> 'experimental'},
    layerTwo:{snapshot:()=>({preview:{goal:'follow'},homeKnown:true})},
    layerThree:{snapshot:()=>({inventoryKnown:true,nearbyItemNames:['minecraft:apple']})},
    lifeSenses:{},
    intelligence:{snapshot:()=>({goal:'standby'})},
    gameplayAgent:{snapshot:()=>({serverVerifiedSteps:0})},
    autonomy:{snapshot:()=>({serverVerifiedSteps:0})},
    gameplayWorld:()=>({safetyHold:false})
  };
  return {world,advance(ms){now+=ms;world.lastServerPositionAt=now;}};
}

test('Voyager skill records accept only verified declarative allow-listed actions',()=>{
  const good={id:'safe_navigation',title:'Safe local navigation',goal:'explore',
    status:'verified',verifiedRuns:2,
    steps:['observe_world','plan_local_route','request_bounded_step',
      'verify_server_position','stop_on_hazard'],updatedAt:10};
  assert.deepEqual(safeSkillRecord(good),good);
  assert.equal(safeSkillRecord({...good,status:'draft'}),null);
  assert.equal(safeSkillRecord({...good,steps:['require("node:child_process").exec("bad")']}),null);
  assert.equal(safeSkillRecord({...good,goal:'creative_mode'}),null);
});

test('curriculum suggests only capabilities currently available in the Bedrock world',()=>{
  const {world}=worldFixture();
  const core=new VoyagerLearningCore();
  const snapshot=core.snapshot(world);
  assert.equal(snapshot.mode,'curriculum_and_declarative_skill_memory');
  assert.equal(snapshot.arbitraryCodeExecution,false);
  assert.equal(snapshot.nextCurriculumTask.id,'safe_navigation');
  world.terrain.snapshot=()=>({collisionClassificationReady:false});
  assert.equal(core.snapshot(world).nextCurriculumTask.id,'observe_world');
});

test('verified navigation experience is counted without confusing queued actions with success',()=>{
  const {world}=worldFixture();
  const core=new VoyagerLearningCore();
  assert.equal(core.observe(world).totalVerifiedNavigationSteps,0);
  world.gameplayAgent.snapshot=()=>({serverVerifiedSteps:3});
  assert.equal(core.observe(world).totalVerifiedNavigationSteps,3);
  world.gameplayAgent.snapshot=()=>({serverVerifiedSteps:3});
  assert.equal(core.observe(world).totalVerifiedNavigationSteps,3);
  world.gameplayAgent.snapshot=()=>({serverVerifiedSteps:1});
  core.observe(world); // new session counter reset; persistent total stays monotonic
  world.gameplayAgent.snapshot=()=>({serverVerifiedSteps:2});
  assert.equal(core.observe(world).totalVerifiedNavigationSteps,4);
});

test('declarative skills and verified totals persist across runtime restarts',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'minepilot-voyager-'));
  try{
    const file=path.join(dir,'learning.json');
    const first=new VoyagerLearningCore({storagePath:file});
    first.totalVerifiedSteps=12;
    const saved=first.promoteVerifiedSkill({id:'safe_navigation',
      title:'Safe local navigation',goal:'explore',status:'verified',
      verifiedRuns:2,steps:['observe_world','plan_local_route',
        'request_bounded_step','verify_server_position','stop_on_hazard'],updatedAt:20});
    assert.equal(saved.status,'accepted');
    const second=new VoyagerLearningCore({storagePath:file});
    assert.equal(second.totalVerifiedSteps,12);
    assert.equal(second.snapshot().skillCount,1);
    assert.equal(second.promoteVerifiedSkill({id:'unsafe',title:'Unsafe',
      goal:'explore',status:'verified',verifiedRuns:1,
      steps:['eval_model_generated_code']}).status,'rejected');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('gameplay skill manifest exposes the Voyager learning status to the existing bridge snapshot',()=>{
  const {world}=worldFixture();
  const manifest=gameplaySkillManifest(world);
  assert.equal(manifest.version,'minepilot.gameplay.skills.v1');
  assert.equal(manifest.learning.version,'minepilot.voyager-learning.v1');
  assert.equal(manifest.learning.arbitraryCodeExecution,false);
  assert.ok(manifest.learning.nextCurriculumTask);
});
