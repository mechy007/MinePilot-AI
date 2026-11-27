# Bedrock ecosystem integration map

This document records how the audited Bedrock-compatible platforms connect to MinePilot-AI. The design goal is one coherent Android runtime, not a collection of competing bot clients.

## Connected architecture

```text
One Microsoft/Xbox friend-world session
              |
PrismarineJS Bedrock client + NetherNet
              |
      BedrockGameplayBridge
              |
      normalized event adapter
              |
     +--------+---------+
     |                  |
 bounded event bus   WorldKnowledgeStore
     |                  |
 read-only plugins   observed metadata index
     |
 planners / task runner / diagnostics
     |
 existing MinePilot validation boundary
     |
 existing movement / inventory / stack-request authorities
```

The live client and Android runtime remain the source of truth. No source project is allowed to add a second authenticated session, second inventory ledger or second movement writer.

## Source-by-source contribution

| Project | Relevant upstream files or areas | MinePilot connection | Treatment |
|---|---|---|---|
| Bedboo | packages/agent/src/planner.js, runner.js, safety.js, bedrock/inventory_model.js, windows.js, click.js, physics | planning/obtain.cjs, tasks/runner.cjs, safety/policy.cjs, inventory/containers.cjs, existing physics vendor | Pinned pure planner directly vendored with LGPL notices; Mineflayer-coupled modules adapted, not imported unchanged |
| MineToring | PalettedStorage.js, BedrockSubChunk.js, BedrockRegistry.js, world/entity maps, bot events | existing terrain cache; packet normalizer, world knowledge store, registry adapter | MIT concepts adapted; separate client and older protocol decoder do not replace MinePilot decoder |
| 27-7 / bedrockflayer | SubChunk.js, ChunkColumn.js, physics/collision.js, plugins/pathfinder.js, recipes and tests | existing terrain/physics plus 3D goals, movement costs, voxel planner and fixtures | MIT concepts adapted; parser assumptions require independent fixture verification |
| BedrockTools | events/Event.hpp, events/EventBus.hpp, RuntimeListener | events/event-bus.cjs | MIT event/lifecycle pattern adapted; game-memory hooks, offsets and injected mod excluded |
| Acacia | world/chunk, physics, navigation, replay and tests | terrain validation, voxel route planner and protocol test strategy | MIT cross-reference; Rust client and transport not embedded |
| PrismarineJS bedrock-protocol | src/client.js, connection, nethernet, datatypes and version schemas | existing single live Android Node SDK and bridge | MIT; retained as sole authenticated client |
| PrismarineJS minecraft-data | versioned Bedrock block states, items, recipes, biomes and protocol data | existing data dependency and canonical MinePilot registry | MIT; pinned data is not assumed to support 1.26.66.1 |
| gophertunnel | minecraft/protocol, NBT and NetherNet | protocol fixture and packet field comparison | MIT cross-reference; no Go client added |
| bedrock-rs | protocol crates, packet structs and client examples | protocol fixtures and schema comparison | Apache-2.0 reference only |
| CloudburstMC Protocol | packet models and codecs | protocol fixtures | Apache-2.0 reference only |
| BedrockSharp | packet models and codecs | protocol fixtures | MIT reference only |
| Bedwire | framing/batch, varints, Snappy and transport | protocol and transport test design | Apache-2.0 reference only; Zig runtime not embedded |
| M9CHKO C++ Bedrock Protocol | C++20 client, RakNet, packet schemas and Android relay sample | native performance/protocol review | No licence identified in repository metadata; no code copied. Its README version list is older than MinePilot's baseline |
| ProtocolGen | schema manifests and generated packet sources | future protocol schema-generation workflow | No code copied; licence and target-version support need verification |
| BedrockDebugProxy | high-fidelity capture, protocol inspection and research proxy | recorder/replay test design | GPL-3.0; concepts only, no GPL code imported |
| Baritone Bedrock | ActionCosts, AStarPathFinder, PathingBehavior, world cache and goals | navigation/goals.cjs, costs.cjs and voxel.cjs | LGPL-3.0 concepts adapted; injected Windows runtime and C++ source not copied |
| Botcraft | C++ bot/session, inventory, interaction and tests | architecture/testing reference | GPL-3.0; no source copied |
| Voyager | skill curriculum and feedback loop | learning/curriculum.cjs | MIT concepts; MinePilot requires server-confirmed outcomes |
| Minecraft AI | action envelope, outcomes, task orchestration and evaluation patterns | actions, outcomes, tasks and learning modules | portable contracts adapted; separate Python runtime not embedded |
| ODYSSEY | skill metadata and catalog patterns | existing Bedrock-adapted ODYSSEY catalogue and skill adapter | retain current catalogue; do not duplicate it |
| JNbot Mobile / LeviBatone / Python Baritone | mobile UI, native ARM64 and probe/controller patterns | UI/performance research and existing movement/diagnostics boundary | runtime-specific reference only; no incompatible backend or injected loader |

## New connected modules

- events/event-bus.cjs: bounded priority pub/sub with listener failure isolation.
- adapters/packet-normalizer.cjs: allowlisted privacy-minimised event projections. Raw packets, NBT, usernames, UUIDs, Xbox IDs, credentials and chat are not forwarded.
- world/knowledge-store.cjs: bounded session-only index for chunk headers, subchunk coordinates, block deltas, nearby entity positions and time. Actual block/collision queries still use BedrockTerrainCache.
- registry/adapter.cjs: normalizes independently extracted registry fixtures and compares them with MinePilot's primary registry. It cannot grant movement authority.
- protocol/differential.cjs: compares safe packet field shapes in captured fixtures. It cannot decode live traffic or replace PrismarineJS.
- navigation/goals.cjs, costs.cjs and voxel.cjs: goal types and bounded 3D route previews. Default transitions are same-height cardinal moves. Any jump, fall, climb, swim or step edge requires an explicit MinePilot validator.
- plugins/registry.cjs: statically registered read-only observers. No remote JavaScript, dynamic imports, eval or packet-write capability.
- sources/catalog.cjs: source and licence/provenance ledger, reused by compatibility snapshots.

BedrockGameplayBridge.bind() invokes the original handler first, then sends the packet through runtimeExtensions.observePacket(). Projection failures are swallowed and redacted so an auxiliary adapter cannot break the live session.

## Version compatibility

Target Bedrock version: **1.26.66.1**. Known codec baseline: **1.26.60 / protocol 2225**. Existing block registry data is captured for the 1.26.60 protocol family. Independent references are cross-check-only. Do not claim target support until exact 1.26.66.1 packet/schema fixtures and a live Android Xbox friend-world session pass.

Required validation includes StartGame, PlayerAuthInput/movement authority, chunk/subchunk palette and block-state IDs, inventory/container transactions, crafting/recipe data, disconnect/reconnect and Android ARM64 packaging.

## Licensing and import policy

- Bedboo is LGPL-3.0-only and retains COPYING, COPYING.LESSER and NOTICE.md.
- Baritone Bedrock and BedrockDebugProxy are copyleft-licensed; their algorithms/workflows are references, not copied source.
- Botcraft is GPL-3.0 and was not imported.
- MIT and Apache-2.0 projects are recorded as reference/adaptation sources. No unverified code blob was added simply because it was portable.
- M9CHKO C++ repository and ProtocolGen are not directly vendored until licensing and provenance are confirmed.
- Every future direct import must include the exact upstream commit, licence texts, notices and dependency/security review.

## Verification limits

These changes connect source adapters and tests. They do not prove Bedrock 1.26.66.1 compatibility, enable new autonomous task execution, or prove live Android gameplay. The existing Xbox/NetherNet, movement and inventory authorities remain unchanged.