# MinePilot Bedrock Runtime Extensions

This is the connected MinePilot-owned integration layer loaded by the existing BedrockGameplayBridge inside the same authenticated friend-world process.

## Connected structure

- contracts.cjs: shared runtime limits and version baseline.
- index.cjs: creates and closes integration services.
- events/event-bus.cjs: bounded priority event bus with listener isolation.
- adapters/packet-normalizer.cjs: allowlisted privacy-minimised projections from the existing PrismarineJS packet stream.
- world/knowledge-store.cjs: bounded session-local chunk, subchunk, block-update, entity and time index; it complements, not replaces, the terrain cache.
- registry/adapter.cjs: external registry normalization and comparison.
- protocol/differential.cjs: fixture-shape comparison across protocol projects; not a live codec.
- sources/catalog.cjs and compatibility/versions.cjs: source, licence and version treatment ledger.
- actions/envelope.cjs and actions/outcomes.cjs: action safety and server-postcondition verification.
- inventory/containers.cjs: Bedboo-inspired container mapping and click previews.
- navigation/astar.cjs: bounded 2D A*; navigation/goals.cjs, costs.cjs and voxel.cjs add conservative 3D route previews.
- planning/goap.cjs and planning/obtain.cjs: bounded goal planning and Bedboo obtain integration.
- safety/policy.cjs, tasks/runner.cjs and learning/curriculum.cjs: survival policy, cancellable tasks and verified learning.
- plugins/registry.cjs: statically registered read-only event observers.
- diagnostics/recorder.cjs: bounded redacted telemetry.
- tests/: runtime and platform integration contracts.

## Single-authority contract

MinePilot retains one Xbox/Microsoft-authenticated Bedrock client, one NetherNet session, one BedrockGameplayBridge, one movement controller, one terrain cache/registry authority, one inventory ledger and one stack-request manager. The new layer observes the same bridge. It never creates another client or dispatches packets.

BedrockTerrainCache remains authoritative for block runtime IDs and collision classification. WorldKnowledgeStore indexes event metadata and short-lived deltas. Independent protocol and registry projects are cross-check sources, not live decoder replacements.

All new navigation, GOAP, obtain, click and inventory plans remain previews (executable:false). Plugin modules are statically registered read-only observers: no dynamic imports or packet-write capability.

## Target version

MinePilot targets Bedrock 1.26.66.1, but the known codec baseline remains Bedrock 1.26.60 / protocol 2225. The new adapters do not change this status. Exact-version fixtures, Android ARM64 tests and live Xbox friend-world validation are still required. 
## Recovery, execution and perception

- recovery/engine.cjs: capability assessment, safe strategy selection and bounded retry accounting.
- `observeBridge()` is called by the live Bedrock control loop. It derives capability readiness from the current movement controller, decoded terrain, server-observed inventory and recipe freshness; it also feeds server-position progress into stuck detection. These are assessments only, not permission to bypass the existing action gates.
- navigation/stuck-recovery.cjs: detects active movement without server-observed progress; returns a recovery recommendation only.
- compatibility/adapter-selector.cjs: selects only exact verified game-version/protocol pairs; unknown versions fail closed.
- world/perception.cjs: freshness-aware queries over observed block updates and entities.
- tasks/execution-coordinator.cjs: capability-gated task runner adapter; requires server-observed completion.

These modules do not create a second client or send packets. No default live gameplay executor is installed; autonomous gathering/mining/combat remains disabled.
