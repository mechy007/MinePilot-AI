'use strict';
const {TARGET_GAME_VERSION,CODEC_BASELINE}=require('../contracts.cjs');
const {sourceCatalog}=require('../sources/catalog.cjs');
const SOURCES=Object.freeze(sourceCatalog().map(source=>({
 project:source.name,repository:source.repository,license:source.license,
 documented:source.role,target:source.target??'Exact target-version support not verified',
 treatment:source.treatment
})));
function compatibilitySnapshot(){
 return {targetGameVersion:TARGET_GAME_VERSION,targetVerified:false,codecBaseline:{...CODEC_BASELINE},
  warning:'Do not treat protocol 2225 / Bedrock 1.26.60 codec support as proof of 1.26.66.1 compatibility.',
  sources:SOURCES.map(source=>({...source}))};
}
module.exports={SOURCES,compatibilitySnapshot};
