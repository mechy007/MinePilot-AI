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
- Do not exclude a technically useful Bedrock implementation merely because it has a large dependency tree, a different language, or a restrictive license. Include candidates in the research and integration plan; preserve their original notices and meet applicable license obligations if code is actually copied or linked. Dependency size is not a discovery filter, but ABI, Android packaging, runtime, and version compatibility must still be solved.
- Work on a feature branch, add tests, verify engine/SDK/Android ARM64 packaging, and do not merge to main without explicit project-owner approval.

## Ecosystem coverage and findings

### 1. Bedrock-native client and bot stacks

| Source | Platform / language | Useful modules or files | MinePilot decision |
|---|---|---|---|
| [Acacia](https://github.com/acacia-rs/acacia) | Rust; Bedrock client/bot | `crates/acacia-bot/src/world/`, `crates/acacia-bot/src/pathfind/`, `crates/acacia-bot/src/movement/`, `crates/acacia-bot/src/interact/`, `crates/acacia-api/`, `crates/acacia-testserver/`, `crates/acacia-mitm/` | Highest-value architecture and algorithm reference. MIT. Port selected algorithms/contracts into existing JS/Android modules; do not replace MinePilot's live Xbox friend-world session. Current upstream README targets protocol 2193 / Bedrock 1.26.51 and says friend-hosted worlds are not supported, so its client/auth stack is not a drop-in replacement. |
| [bedboo](https://github.com/LiteLDev/bedboo) | Node.js 24; Bedrock bot API | `packages/bedboo/lib/physics/engine.js`, `packages/bedboo/lib/physics/aabb.js`, `packages/bedboo/lib/bedrock/inventory_model.js`, `packages/bedboo/lib/bedrock/windows.js`, `packages/bedboo/lib/bedrock/click.js`, `packages/agent/src/planner.js`, `runner.js`, `safety.js`, `skills/`, `test/` | Top source-code candidate for direct study, vendoring or adaptation. The inventory model, container mappings, click-to-stack-request translation, Bedrock physics, obtain planner, task runner and safety layer are concrete files—not just design inspiration. Its documented stable BDS support currently stops at 1.26.63.1, so it is not yet proven against MinePilot's 1.26.66.1 target. Include its dependency tree in the port plan; preserve source notices and satisfy applicable license terms if copying. |
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
- Do not reject a useful source solely because it is LGPL or has substantial dependencies; include it and handle the applicable obligations if adopted.
- No arbitrary upstream JavaScript execution, shell access or raw packet execution from an LLM.
- No declaring a skill ready based only on catalog metadata, simulated tests or generated plans.
- No automatic local AI fallback when Remote AI is disabled or unavailable.


### 5. Additional language and mobile platforms discovered

| Source | Platform / language | Reusable value | Limits / decision |
|---|---|---|---|
| [BedrockSharp](https://github.com/BedrockSharp/bedrock-protocol) | C# / .NET, MIT | Independent packet codec and RakNet implementation for protocol cross-checks and fixture generation. | No reason to add a .NET runtime to MinePilot Android; use as a second implementation for protocol validation. |
| [CloudburstMC/Protocol](https://github.com/CloudburstMC/Protocol) | Java, Apache-2.0 | Bedrock codec, connection and version-specific serializers; useful as an independent Java-side packet schema check. | Check exact supported version before relying on it for 1.26.66.1; avoid a second networking stack. |
| [Bedwire](https://github.com/Bedrock-Phanatics/bedwire) | Zig, Apache-2.0 | Session framing, compression, encryption, login/session state, bounded buffers and RakNet/NetherNet transport adapters. | Strong protocol architecture reference; not a gameplay bot and would require a new Zig/NDK integration. |
| [LeviBatone](https://github.com/sang765/levibatone) | C++ native Android ARM64 client mod, LGPL-3.0 | Bedrock 1.26.60 client-side Baritone pathing, movement costs, jump/fall/swim/climb/bridge movement and touch HUD ideas. | Injected in-process mod for LeviLauncher, not an independent Xbox friend-world bot. Reuse algorithms only; LGPL and game-version-specific offsets make direct copying unsuitable. |
| [chase-west/minecraft-bot](https://github.com/chase-west/minecraft-bot) | TypeScript / Node, MIT | Bedrock protocol agent with 20 Hz PlayerAuthInput, 3D A*, GOAP, ONNX DQN, rollout recording and optional LLM goal selection. | Dedicated-server / offline-mode test assumptions must be checked; adapt its controller separation, observation encoding and evaluation ideas, not its account/session code. |
| [JNbot Mobile](https://github.com/JNbot-app/JNbot-mobile) | React Native / Expo, MIT | Mobile bot profile management, secure tokens, remote WebRTC connection, logs and action-chain UX. | App/controller architecture reference only until its actual bot backend and Bedrock compatibility are verified. Do not replace MinePilot's native Android UI/runtime. |
| [EndstoneMC/bedrock-protocol](https://github.com/EndstoneMC/bedrock-protocol) | C++, Python, Java, MIT | Independent multi-language packet codecs and protocol version tables. | Protocol conformance and fixture-generation reference; not a replacement for the existing Android session. |
| [PyBedrock Net](https://pypi.org/project/pybedrock-net/) | Python, MIT (package metadata) | Layered RakNet, packet, auth, world, inventory and bot APIs. | Secondary research/test implementation; confirm repository provenance and exact version support before using any code. |

The additional survey confirms that the ecosystem spans Rust, JavaScript/TypeScript, Python, C#, Java, C++, Go and Zig. It does not imply all projects are suitable runtime dependencies. MinePilot should stay on its existing Android + embedded Node path and use other language implementations as algorithm, protocol and test references unless a measured gap justifies a native module.


## 6. Bedrock-only file shortlist (expanded after the user's instruction)

The search filter is now technical Bedrock relevance, not license family or dependency size. Candidates below are included even when they require additional packages, a native build, or a different implementation language. Exact target-version support remains a separate test gate.

### Highest-value files to inspect or port

| Source file / directory | What it contains | MinePilot use |
|---|---|---|
| [bedboo inventory_model.js](https://github.com/LiteLDev/bedboo/blob/main/packages/bedboo/lib/bedrock/inventory_model.js) | Server-authoritative inventory model, Java-slot-to-Bedrock-container mapping, predicted stack updates, request correlation, rollback, per-slot request chains and resync | Compare against and selectively extend `scripts/bedrock-inventory-ledger.cjs` + `scripts/bedrock-stack-request-manager.cjs`; likely the biggest useful inventory implementation |
| [bedboo windows.js](https://github.com/LiteLDev/bedboo/blob/main/packages/bedboo/lib/bedrock/windows.js) | Bedrock container/window registry, slot maps, player inventory layout, station/container metadata | Add missing container semantics to MinePilot's inventory model |
| [bedboo click.js](https://github.com/LiteLDev/bedboo/blob/main/packages/bedboo/lib/bedrock/click.js) | Pure click semantics converted into Bedrock item-stack-request steps | Reuse/adapt the pure transformation logic and test cases |
| [bedboo physics engine.js](https://github.com/LiteLDev/bedboo/blob/main/packages/bedboo/lib/physics/engine.js) | Bedrock-specific player simulation, collision, friction, jumping, sneaking, liquids and movement corrections | MinePilot already vendors a bedboo-derived physics engine under `vendor/bedboo-physics/`; compare versions and bring over missing tested fixes, not a duplicate engine |
| [bedboo planner.js](https://github.com/LiteLDev/bedboo/blob/main/packages/agent/src/planner.js) | Pure obtain planner for inventory, recipes, smelting, fuels, sources, tools and stations | Adapt as a planning-only module using MinePilot's world snapshot and action gates |
| [bedboo runner.js](https://github.com/LiteLDev/bedboo/blob/main/packages/agent/src/runner.js) | Scripted task runner, timeout/retry, progress events, task reports and stuck recovery | Merge useful task lifecycle/reporting patterns into MinePilot's agent |
| [bedboo safety.js](https://github.com/LiteLDev/bedboo/blob/main/packages/agent/src/safety.js) | Background threat response, flee/fight guard, lava/fire escape, drowning, suffocation and recovery | Extract safety priorities and recovery tests; route all actions through MinePilot's existing authority |
| [bedrockflayer / 27-7](https://github.com/inuttan/27-7) | Bedrock bot framework with subchunk palettes, A*, block/item registries, recipes, physics and plugin modules | Broad alternative source pool for world parsing, recipe handling and navigation; its README says protocol support is behind, so version-gate it |
| [LeviBatone](https://github.com/sang765/levibatone/tree/main/src) | Native C++ Bedrock client-side Baritone-style navigation for Android ARM64 / LeviLauncher | Inspect movement costs, path nodes, goal handling, mining/farming and touch controls; client injection model is not MinePilot's connection architecture |
| [chase-west/minecraft-bot](https://github.com/chase-west/minecraft-bot/tree/main/src) | Bedrock protocol bot, 20 Hz PlayerAuthInput loop, 3D A*, GOAP, DQN/ONNX and trajectory collection | Extract agent/planner/evaluation concepts; its documented setup uses offline-mode BDS, not MinePilot's Xbox friend-world session |
| [Acacia](https://github.com/acacia-rs/acacia/tree/main/crates/acacia-bot/src) | Rust Bedrock world, pathfinding, movement and interaction modules | Port algorithmically or bind selected Rust components through Android NDK only where it materially outperforms the existing JS path |
| [Minecraft AI action envelope](https://github.com/Ace1928/minecraft_ai/tree/main/src/minecraft_ai/control) | Action envelopes, outcomes and operator budgets | Bring bounded action contracts and postcondition/outcome verification into MinePilot's planner interface |

### Protocol and transport files that matter for current Bedrock

- [PrismarineJS bedrock-protocol package.json](https://github.com/PrismarineJS/bedrock-protocol/blob/master/package.json): current package is 3.61.0, requires Node >=24, includes `nethernet` and `prismarine-auth`, and retains RakNet packages as well.
- [bedrock-protocol API / NetherNet options](https://github.com/PrismarineJS/bedrock-protocol/blob/master/docs/API.md): exposes transport selection, Xbox auth flow, Realm/world selection, WebRTC backend selection and NetherNet signalling modes.
- [node-nethernet src](https://github.com/PrismarineJS/node-nethernet/tree/master/src): WebRTC transport, discovery, signalling, data channels, identity signing and peer lifecycle. It does not authenticate Microsoft/Xbox accounts itself; it expects the authentication layer to supply the identity token/key.
- [Mojang NetherNet onboarding guide](https://github.com/Mojang/bedrock-protocol-docs/blob/main/additional_docs/NetherNetOnboardingGuide.md): authoritative HTTP signalling and SDP exchange details.
- [Bedrock Wiki RakNet notes](https://wiki.bedrock.dev/servers/raknet): reports that Bedrock 26.60 clients no longer connect over RakNet and require NetherNet. Do not design new MinePilot connectivity around RakNet-only code.
- [bedboo supported versions](https://levimc.org/bedboo/reference/versions/): tested stable BDS range currently ends at 1.26.63.1 (protocol 2225 family). This is newer than MinePilot's 1.26.60 code markers but still does not prove 1.26.66.1 support.
- [bedboo connection differences](https://levimc.org/bedboo/reference/differences/connection): documents its NetherNet/RakNet selection and direct signalling behavior.

### MinePilot compatibility gaps found in its current files

1. `scripts/bedrock-inventory-ledger.cjs` explicitly identifies itself as a Bedrock 1.26.60 inventory mirror.
2. `scripts/bedrock-stack-request-manager.cjs` hardcodes `LEGACY_ACTION_IDS_1_26_60`; this must become versioned protocol data rather than an unqualified constant.
3. `scripts/bedrock-movement-controller.cjs` already imports the vendored `vendor/bedboo-physics` engine. Do not import another physics engine beside it.
4. `scripts/bedrock-terrain-cache.cjs` contains its own runtime-palette subchunk decoder. Cross-check its bit widths, palette storage versions, bounds and malformed-packet behavior against multiple Bedrock parsers and current protocol fixtures.
5. `scripts/bedrock-gameplay-agent.cjs` already enforces fresh server position, classified terrain, bounded actions and acknowledgement checks. Bedboo's richer planner/skills must call this existing authority rather than create a second movement actor.

### Version and integration rule

MinePilot's target is Bedrock 1.26.66.1, while the directly inspected MinePilot inventory code is labelled 1.26.60, bedrock-protocol 3.61.0 advertises 1.26.60 support, and bedboo's tested stable matrix currently ends at 1.26.63.1. Therefore, no external module is to be labelled fully compatible with 1.26.66.1 until packet/version fixtures and a real friend-world session pass. We can still import its source and dependencies into an isolated feature branch, then adapt and test them against MinePilot's existing NetherNet session.

## 7. Immediate integration order

1. Port/merge bedboo's inventory model, windows and click transformations into MinePilot's existing inventory ledger and stack-request manager, retaining the single existing client and response correlation.
2. Port the pure bedboo obtain planner and connect its output only to MinePilot's allow-listed skill manifest and action gate.
3. Compare bedboo physics fixes against the already vendored physics engine and update that vendor in place if tests demonstrate a gap.
4. Cross-check and extend the subchunk parser using current Bedrock protocol fixtures; use bedboo/27-7 and JSPrismarine as alternate decoders.
5. Inspect LeviBatone's native movement code and Acacia pathfinder as candidate improvements, but do not replace the current verified movement controller.
6. Upgrade protocol/data version support to the exact 1.26.66.1 target, including NetherNet session behavior, before declaring end-to-end compatibility.
