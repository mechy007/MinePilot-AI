# Bedrock Reference Research and MinePilot Adaptation

This document records the external Bedrock implementations studied for MinePilot and separates reusable engineering ideas from platform-specific code.

## Projects reviewed

| Project | Relevant engineering | MinePilot decision |
| --- | --- | --- |
| [Acacia](https://github.com/acacia-rs/acacia) | Bedrock protocol client, chunk/block state model, player physics, bounded A* pathfinding, gameplay actions | Use as a reference for protocol/world-state boundaries, search budgets, and later movement-state planning. Its Rust runtime is not transplanted into the Android Node/C++ architecture. |
| [bedrockflayer / 27-7](https://github.com/inuttan/27-7) | Subchunk palettes, block lookup, AABB collision, goal-based pathfinding, movement neighbors | Use as a reference for diagonal corner clearance, explicit movement costs, and testable world queries. Reimplement in MinePilot's own CommonJS modules and data contracts. |
| [Baritone Bedrock](https://github.com/miked06/baritone-bedrock) | Terrain snapshots, path search, movement costs, cached world scanning, offline pathfinder tests | Use as a reference for separating world snapshots from search and keeping planning bounded. Windows game hooks and DLL integration are not applicable to Android. |
| [bedboo](https://github.com/LiteLDev/bedboo) | Bedrock-specific player physics and collision implementation | MinePilot already contains a Bedrock physics adaptation in `vendor/bedboo-physics`; improve its integration through MinePilot's registry and movement controller rather than adding a second competing physics engine. |
| [MineToring](https://github.com/nootbook011/MineToring) | Bedrock entity metadata, block storage, chunk/subchunk and biome model | Keep as a reference for future world/entity observation coverage; do not replace MinePilot's existing transport. |

## Current MinePilot architecture observed

- Bedrock connection and Xbox friend-world session: `src/connection/` and Android session/transport code.
- Terrain parsing/cache: `scripts/bedrock-terrain-cache.cjs`.
- Exact runtime-state mapping and collision profiles: `scripts/bedrock-runtime-registry.cjs` and `scripts/bedrock-collision-data.cjs`.
- Bedrock movement physics: `scripts/bedrock-movement-controller.cjs` plus `vendor/bedboo-physics/`.
- Local navigation: `scripts/bedrock-local-path.cjs`.
- Terrain recovery and subchunk polling: `scripts/bedrock-gameplay-bridge.cjs` and `scripts/bedrock-terrain-check.cjs`.

## First adaptation delivered

`bedrock-local-path.cjs` now uses a binary min-heap instead of sorting the entire open set for every expansion. It uses an octile-distance heuristic and permits diagonal moves only when the destination and both adjacent cardinal cells are verified safe. The search remains bounded and does not reinterpret unknown terrain as air.

The planner still refuses vertical-level changes. This is intentional: the current terrain cache only classifies full-cube support as walkable, and the current planner does not yet have a complete verified transition model for stepping, jumping, falling, swimming, or climbing. Those movement types must be backed by actual collision geometry and the Bedrock physics simulator before being enabled.

## Next high-value ports

1. **Movement-neighbor model:** create a MinePilot-native successor generator for walk, step, jump, controlled fall, swim and climb. Every edge must be simulated against the existing Bedrock physics and exact collision shapes.
2. **Collision-shape query API:** expose verified AABB lists and support surfaces from the existing collision registry. Partial blocks must remain unknown until exact state-dependent shapes are available.
3. **Goal model:** add block, near-position, follow-entity and resource goals without coupling the search to packet or Android APIs.
4. **World snapshot interface:** provide immutable bounded snapshots to the planner so packet callbacks never block on search.
5. **Replay-based movement tests:** compare predicted position/velocity with recorded server corrections and live telemetry before enabling new movement types.

## Safety and verification rules

- Unknown block states and unknown collision geometry are never assumed empty or solid.
- A decoded subchunk is not considered a verified collision map until its runtime IDs resolve through the matching version registry.
- A planned route is not an executed route. Movement completion must be confirmed from authoritative player state.
- Multiplayer actions must remain within the server/world owner's rules and supported client behaviour.
- A local unit test is not a substitute for a live Xbox-hosted friend-world test.
