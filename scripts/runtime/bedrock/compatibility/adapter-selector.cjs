'use strict';
const {CODEC_BASELINE,TARGET_GAME_VERSION}=require('../contracts.cjs');
const SUPPORTED=Object.freeze([{gameVersion:CODEC_BASELINE.gameVersion,protocol:CODEC_BASELINE.protocol,adapter:'bedrock-protocol-pinned',verified:true}]);
function detectCompatibility(meta={}) {
 const gameVersion=typeof meta.gameVersion==='string'?meta.gameVersion:null;
 const protocol=Number.isInteger(meta.protocol)?meta.protocol:null;
 const match=SUPPORTED.find(v=>(!gameVersion||v.gameVersion===gameVersion)&&(!Number.isInteger(protocol)||v.protocol===protocol));
 const exact=!!match&&(!gameVersion||match.gameVersion===gameVersion)&&(!Number.isInteger(protocol)||match.protocol===protocol);
 return {gameVersion,protocol,targetGameVersion:TARGET_GAME_VERSION,adapter:exact?match.adapter:null,
  status:exact?'known_baseline':'unknown_or_unverified',verified:exact,
  allowProtocolActions:exact,reason:exact?'known_codec_baseline':'version_not_in_verified_adapter_matrix'};
}
function selectAdapter(meta,adapters=[]) {
 const detected=detectCompatibility(meta),adapter=detected.verified?adapters.find(a=>a?.id===detected.adapter&&typeof a.validate==='function'&&a.validate(meta)):null;
 return {...detected,selected:adapter?.id??null,usable:!!adapter};
}
module.exports={SUPPORTED,detectCompatibility,selectAdapter};
