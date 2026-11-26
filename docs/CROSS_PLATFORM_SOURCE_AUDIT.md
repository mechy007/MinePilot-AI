# Cross-platform source audit and MinePilot integration plan

Updated: 2026-11-27
Target: MinePilot-AI, Android ARM64, Minecraft Bedrock 1.26.66.1, Vivo V2544 (8 GB RAM).

## Purpose

Research useful implementations across the Minecraft Bedrock, bot, AI-agent, protocol, Android and remote-inference ecosystems. Reuse proven ideas and source code where compatible, but adapt them to MinePilot's Android runtime, current protocol, single authenticated friend-world session, and server-authoritative action model.

This is a source audit and integration map, not a claim that every listed upstream feature is already integrated.

## Non-negotiable MinePilot constraints

- Preserve the existing Microsoft/Xbox authentication and friend-world NetherNet connection. Do not replace it with a second client.
- Keep exactly one live Bedrock session and one movement/action authority.
- Android remains responsible for world observations, capability gates, execution, user confirmation, emergency stop and server-side outcome verification.
- Remote AI has a manual ON/OFF control. When OFF, no remote model calls occur. Do not silently fall back to a local model. Minecraft connection and manual gameplay remain independent of Remote AI.
- The planned remote AI topology is Android -> authenticated HTTPS/WSS gateway -> remote GPU worker (Kaggle first). The worker returns bounded, schema-validated goals/plans, never raw packets or unrestricted commands.
- Keep experimental, preview-only and unsupported capabilities visibly distinct from verified capabilities.
- Preserve license files, notices, attribution and source provenance for every reused component.
- Work on a feature branch, add tests, verify engine/SDK/Android ARM64 packaging, and do not merge to main without explicit project-owner approval.

## Ecosystem coverage and findings

### 1. Bedrock-native client and bot stacks

| Source | Platform / language | Useful modules or files | MinePilot decision |
|---|---|---|---|
| [Acacia](https://github.com/acacia-rs/acacia) | Rust; Bedrock client/bot | `crates/acacia-bot/src/world/`, `crates/acacia-bot/src/pathfind/`, `crates/acacia-bot/src/movement/`, `crates/acacia-bot/src/interact/`, `crates/acacia-api/`, `crates/acacia-testserver/`, `crates/acacia-mitm/` | Highest-value architecture and algorithm reference. MIT. Port selected algorithms/contracts into existing JS/Android modules; do not replace MinePilot's live Xbox friend-world session. Current upstream README targets protocol 2193 / Bedrock 1.26.51 and says friend-hosted worlds are not supported, so its client/auth stack is not a drop-in replacement. |
| [bedboo](https://github.com/LiteLDev/bedboo) | Node.js 24; Bedrock bot API | `packages/bedboo/lib/physics/`, `packages/bedboo/lib/bedrock/inventory_model.js`, `packages/bedboo/lib/plugins/inventory.js`, `packages/bedboo/lib/plugins/craft.js`, `packages/agent/src/planner.js`, `runner.js`, `safety.js`, `skills/`, `test/` | Excellent Bedrock behavior reference and compatibility target. LGPL-3.0-only: do not copy implementation files into MinePilot without a deliberate LGPL compliance decision and preserving notices/source obligations. Prefer independently reimplementing the behavior behind MinePilot interfaces; vendor/link only when the license and Android ABI/runtime are verified. Node 24 is compatible in principle with the current runtime, but upstream RakNet native dependencies have x64-only constraints; its pure-JS NetherNet route is more relevant. |
| [PrismarineJS/bedrock-protocol](https://github.com/PrismarineJS/bedrock-protocol) | JavaScript / Node | `src/`, `docs/API.md`, protocol serializers, auth and transport adapters | Existing MinePilot dependency and current protocol foundation. MIT. Keep pinned versions and update protocol support deliberately. |
| [minecraft-data](https://github.com/PrismarineJS/minecraft-data) | Multi-language generated data | Bedrock blocks, items, recipes, entities, protocol and collision-shape datasets; audit scripts and JSON schemas | Use as versioned data source with provenance and automated schema/data checks. Never assume Java data is interchangeable with Bedrock. |
| [bedrock-rs](https://github.com/bedrock-crustaceans/bedrock-rs) | Rust | protocol, network, auth, level, form and addon crates | Apache-2.0 cross-check for packet/auth/world behavior; not a direct Android integration until FFI/ABI and protocol compatibility are demonstrated. |
| [Endstone Bedrock Protocol](https://github.com/EndstoneMC/bedrock-protocol) | C++ core with Python and Java bindings | generated protocol codecs and version-specific modules | Useful independent protocol cross-check and potential fixture source. Check current supported protocol before use. |
| [gophertunnel](https://github.com/Sandertv/gophertunnel) | Go | Bedrock packet/network/session implementation | Independent reference for wire semantics and edge cases; not a runtime dependency by default. |

### 2. Navigation, physics and world state

| Source | Exact useful areas | Adaptation |
|---|---|---|
| Acacia | `crates/acacia-bot/src/pathfind/astar.rs`, `execute.rs`, `costs.rs`, `cell.rs`, `cache.rs`, `world/` | Compare search costs, partial-path behavior, route follower, replanning and bounded world reads against MinePilot's PR #130. |
| bedboo | `packages/bedboo/lib/physics/engine.js`, `input.js`, `aabb.js`, physics fixtures and movement docs | Use measured Bedrock tick order, collision, jump, friction, sneak and correction behavior as a test oracle. Existing MinePilot `vendor/bedboo-physics/` already contains a licensed physics adaptation; do not duplicate it. |
| [Baritone Bedrock](https://github.com/miked06/baritone-bedrock) | Path planning, mining/building/exploration concepts | Windows-specific injected DLL and version-specific hooks are not portable. Reuse algorithms and task semantics only, not injection/hooking code. |
| [baritone-bedrock Python port](https://github.com/kirbycope/baritone-bedrock) | `docs/research-movements.md`, `docs/baritone-port-plan.md`, navigator/probe separation | Useful controller-independent planning and tick execution reference. Its behavior-pack probe and external controller are not MinePilot's live Bedrock protocol path. |
| [Bedrock Wiki](https://wiki.bedrock.dev/) and [Mojang protocol docs](https://mojang.github.io/bedrock-protocol-docs/) | Protocol, subchunk polling, movement, packets and version changelogs | Primary verification sources. Protocol changes must be checked against exact target build 1.26.66.1. |
| [bedrocktool](https://github.com/bedrock-tool/bedrocktool) | PCAP2 capture/replay, packet/event scripts, chunk/entity capture | Strong reference for reproducible diagnostics and offline regression fixtures. Adapt the capture/replay idea to MinePilot's privacy-safe, bounded test fixtures. |

### 3. AI agents, skills and learning

| Source | Useful files / concepts | MinePilot decision |
|---|---|---|
| [Voyager](https://github.com/MineDojo/Voyager) | `skill_library/`, automatic curriculum, skill retrieval, iterative execution feedback and self-verification | MIT. Its Mineflayer/Java-oriented runtime is not imported. MinePilot already has a Voyager-inspired learning loop and skill memory; extend the Bedrock-native actor and verification instead of loading Voyager's second client. |
| [ODYSSEY](https://github.com/zju-vipa/Odyssey) | `MC-Comprehensive-Skill-Library/skill/`, `LLM-Backend/`, skill metadata and dependency graphs | MIT. MinePilot already includes the 183-composition metadata catalog and 20 primitive-name mappings. The catalog is not 183 runnable Bedrock skills; keep unsupported primitives blocked. Do not execute upstream generated JavaScript. |
| [Minecraft AI](https://github.com/Ace1928/minecraft_ai) | `src/minecraft_ai/control/action_envelope.py`, `outcomes.py`, `operator_budget.py`, `cognition/`, `curriculum.py`, `datasets/`, `episodes.py`, `bridge/` | Apache-2.0. Adapt model-independent action permission envelopes, temporal outcome verification, operator budgets, memory/trajectory schemas and two-speed control. Its default Windows Bedrock + Linux/WineGDK + visual controller environment is not the Android runtime and should not be imported wholesale. |
| [MineDojo](https://github.com/MineDojo) | benchmark/dataset/research ecosystem | Use for evaluation design and task coverage, not as a runtime dependency. Validate licensing and exact dataset provenance before bundling data. |

### 4. Android and remote AI

| Source | Useful areas | MinePilot decision |
|---|---|---|
| [nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile) | Android JNI Node runtime integration | Compare with MinePilot's existing embedded Node runtime and packaging. Do not add a second Node runtime. |
| Android official docs | Foreground services, notification permissions, lifecycle, network callbacks, Keystore | Use as authority for background session behavior, reconnect lifecycle and credential security. |
| [SeekerClaw](https://github.com/sepivip/SeekerClaw) | Android foreground Node runtime, Keystore, localhost IPC | Architecture reference only; validate its Node version and service type against MinePilot's SDK and current Android target. |
| [Codex Remote Control](https://github.com/chenhaoc/codex-remote-control) | Kotlin/Compose WebSocket client, token-authenticated bridge, streaming events | Reuse interface and reconnect patterns for remote planner status, not its Codex-specific protocol. |
| Kaggle GPU worker + authenticated gateway | Outbound worker connection, remote model execution | Preserve user decision: Kaggle first, provider architecture remains interchangeable; manual Remote AI toggle, no local fallback, no effect on Minecraft connectivity. |

## Existing MinePilot assets that must be reused before adding dependencies

The main branch already contains substantial native foundations:

- Android: `DashboardActivity.java`, `DashboardShell.java`, `BotSessionProvider.java`, `ManualControlPanel.java`, `ManualJoystickView.java`, `GameplayPlanner.java`, `GameplayActionGate.java`, `SkillsScreen.java`, `HealthMonitorView.java`.
- Live Bedrock runtime: `scripts/android-friend-world-session.cjs`, `scripts/bedrock-gameplay-bridge.cjs`, `scripts/bedrock-movement-controller.cjs`, `scripts/bedrock-terrain-cache.cjs`, `scripts/bedrock-inventory-ledger.cjs`, `scripts/bedrock-stack-request-manager.cjs`.
- Agent and learning: `scripts/bedrock-gameplay-agent.cjs`, `scripts/bedrock-native-skill-system.cjs`, `scripts/bedrock-odyssey-skill-library.cjs`, `scripts/bedrock-voyager-learning.test.cjs`, `src/gameplay/companion-engine.ts`, `src/gameplay/navigation-authority.ts`.
- Existing licensed physics vendor: `vendor/bedboo-physics/` including `COPYING`, `COPYING.LESSER`, `NOTICE.md` and `BEDROCK-DATA-NOTICE.md`.
- Existing tests: engine tests, gameplay bridge/agent tests, inventory and stack-request tests, movement/terrain tests, Android unit tests and Android runtime contract workflow.

Do not create parallel implementations of these systems without first proving the current module is insufficient.

## Priority integration backlog

1. **Source and license ledger**: record every adopted file, upstream commit, license, modifications, notices and MinePilot destination.
2. **World/terrain correctness**: compare MinePilot terrain cache and PR #129 with Acacia's world tracker and official Bedrock subchunk semantics. Keep unknown terrain unknown; bound memory to nearby chunks.
3. **Navigation**: compare PR #130 against Acacia A*, bedboo pathfinder and Baritone concepts. Add jump/fall/swim/climb and partial-block traversal only as individually tested movement modes; no unsafe shortcut.
4. **Inventory/action transactions**: compare MinePilot inventory ledger and stack-request manager against bedboo inventory model and Acacia interaction modules. Implement one action at a time with fresh preconditions, correlated server response and postcondition verification.
5. **Task planner**: adapt bedboo's pure obtain planner and Minecraft AI's bounded task/outcome contracts to MinePilot's Bedrock world snapshot and allow-listed skill registry.
6. **Safety and recovery**: adapt safety priority, stuck detection, cancellation/wind-down and temporal outcome evidence. Emergency stop and survival override always outrank AI proposals.
7. **Skill learning**: extend Voyager/ODYSSEY-inspired skill composition only after every primitive in the dependency chain has a real Bedrock executor and verifier.
8. **Remote AI**: add the manually controlled remote planner gateway and Kaggle worker; keep AI suggestions schema-limited and require MinePilot's local deterministic gate before action dispatch. No local-model fallback.
9. **Android usability/performance**: keep UI phone-first, runtime ARM64, bounded memory, battery-aware polling and foreground-service lifecycle behavior.
10. **Verification**: unit tests, recorded packet fixtures/replay, SDK contract tests, ARM64 APK packaging, then private friend-world tests on the exact target version. CI success is not live gameplay proof.

## Explicit exclusions

- No replacement of the existing Xbox/NetherNet friend-world connection with a second bot client.
- No Java Edition/Fabric runtime or Windows DLL injection in the Android app.
- No copying of LGPL source into MinePilot without compliance review.
- No arbitrary upstream JavaScript execution, shell access or raw packet execution from an LLM.
- No declaring a skill ready based only on catalog metadata, simulated tests or generated plans.
- No automatic local AI fallback when Remote AI is disabled or unavailable.
