'use strict';
const { TARGET_GAME_VERSION, CODEC_BASELINE } = require('../contracts.cjs');
const SOURCES = Object.freeze([
  ['Bedboo','BDS 1.26.42.1–1.26.63.1','1.26.66.1 not documented','portable planner, physics and adapted inventory concepts'],
  ['PrismarineJS bedrock-protocol','3.61.0 / 1.26.60 codec','not verified','existing sole authenticated client'],
  ['PrismarineJS node-nethernet','NetherNet/WebRTC','live friend-world test required','existing transport reference; no second client'],
  ['Acacia','documented 1.26.51','not verified','Rust world/pathfinding/replay reference'],
  ['27-7 bedrockflayer','protocol range needs verification','not verified','palette/registry/recipe reference'],
  ['LeviBatone','native Android injected launcher','not MinePilot session-compatible','ARM64 navigation optimisation ideas'],
  ['chase-west/minecraft-bot','desktop/offline setup','not verified','GOAP/A*/trajectory concepts'],
  ['Ace1928/minecraft_ai','Python/Pydantic desktop runtime','not Android runtime-compatible','action envelope and outcome verification'],
  ['Voyager','Java/Mineflayer','not Bedrock-runtime-compatible','curriculum and skill learning concepts'],
  ['ODYSSEY','catalog metadata','already represented in MinePilot','keep existing Bedrock-adapted 183-entry catalogue'],
  ['bedrock-rs','Rust Bedrock protocol','not verified','independent packet cross-check'],
  ['gophertunnel','Go Bedrock protocol','not verified','independent packet cross-check'],
  ['Endstone bedrock-protocol','Bedrock protocol','not verified','independent packet cross-check'],
  ['BedrockSharp','C# Bedrock protocol','not verified','independent packet cross-check'],
  ['CloudburstMC Protocol','Java Bedrock protocol','not verified','independent packet cross-check'],
  ['Bedwire','Zig network library','not verified','transport reference only'],
  ['Baritone Bedrock','Windows injected DLL','architecture incompatible','goal-based navigation concepts'],
  ['Python Baritone port','probe/controller pattern','runtime differs','observation/controller separation'],
  ['bedrocktool','packet diagnostics/replay','exact target fixtures required','redacted diagnostics and replay-test patterns'],
  ['JNbot Mobile','mobile UX/backend needs checking','backend compatibility unverified','Android control UX reference']
].map(([project,documented,target,treatment])=>({project,documented,target,treatment})));
function compatibilitySnapshot() {
  return { targetGameVersion: TARGET_GAME_VERSION, targetVerified: false,
    codecBaseline: { ...CODEC_BASELINE },
    warning: 'Do not treat protocol 2225 / Bedrock 1.26.60 codec support as proof of 1.26.66.1 compatibility.',
    sources: SOURCES.map(v=>({...v})) };
}
module.exports = { SOURCES, compatibilitySnapshot };
