import test from 'node:test';
import assert from 'node:assert/strict';
import { LayerEightReadiness, type RuntimeEvidence } from '../src/gameplay/layer-eight.js';
const good: RuntimeEvidence = {
  spawned:true, hasSelfEntity:true,hasPosition:true,positionAgeMs:100,
  receivedChunkHeaders:3,movementAuthority:1,blocksDecoded:false,
  movementCorrections:0,sessionClosed:false
};
test('connected planning state does not equate to autonomous gameplay or release readiness',()=>{
  const gate=new LayerEightReadiness();
  const status=gate.assess(good);
  assert.equal(status.stage,'planning_preview');
  assert.equal(status.commandEligible,true);
  assert.equal(status.releaseReady,false);
  assert.equal(status.autonomousGameplayReady,false);
  assert.equal(status.liveWalkVerified,false);
  assert.equal(status.actionsVerified,false);
  assert.ok(status.blockers.includes('host_verified_movement_missing'));
  assert.ok(status.blockers.includes('decoded_collision_voxels_missing'));
});
test('stale or absent player position blocks new plans without breaking existing login',()=>{
  const gate=new LayerEightReadiness();
  for(const bad of [
    {...good,positionAgeMs:30001},
    {...good,positionAgeMs:null},
    {...good,hasPosition:false},
    {...good,receivedChunkHeaders:0},
    {...good,spawned:false},
    {...good,sessionClosed:true}
  ]){
    const status=gate.assess(bad);
    assert.equal(status.commandEligible,false);
    assert.equal(gate.allowPreview(bad).allowed,false);
    assert.equal(status.releaseReady,false);
  }
  assert.equal(gate.allowPreview({...good,positionAgeMs:30001}).reason,'server_position_stale');
  assert.equal(gate.allowPreview({...good,sessionClosed:true}).reason,'connection_closed');
});
test('idle spawn anchor permits limited planning preview without implying server confirmation',()=>{
  const gate=new LayerEightReadiness();
  const status=gate.assess({...good,positionAgeMs:12000,idlePositionAnchor:true});
  assert.equal(status.commandEligible,true);
  assert.equal(status.commandReason,'idle_spawn_anchor');
  assert.equal(status.observed.positionMode,'idle_spawn_anchor');
  assert.equal(status.releaseReady,false);
  assert.equal(status.liveWalkVerified,false);
  const invalidated=gate.assess({...good,positionAgeMs:12000,idlePositionAnchor:false});
  assert.equal(invalidated.commandEligible,false);
  assert.equal(invalidated.commandReason,'server_position_stale');
});

test('untrusted codec and block flags never fabricate live device acceptance',()=>{
  const gate=new LayerEightReadiness();
  const evidence=gate.assess({...good,blocksDecoded:true,movementAuthority:1,
    movementCorrections:200,receivedChunkHeaders:128,positionAgeMs:0});
  assert.equal(evidence.releaseReady,false);
  assert.equal(evidence.terrainVerified,false);
  assert.equal(evidence.liveWalkVerified,false);
  assert.equal(evidence.observed.corrections,200);
  assert.equal(gate.allowPreview({...good,receivedChunkHeaders:129}).allowed,false);
});
