# Modular Gameplay Integration

**Implementation branch:** feature/minepilot-modular-gameplay-restructure  
**Base:** main at 2c544877627f948a9dd3fec5969b4a793cb629c4  
**Target device:** Android ARM64  
**Requested Bedrock target:** 1.26.66.1 (unverified)  
**Known codec baseline:** Bedrock 1.26.60 / protocol 2225

## 1. Architecture boundary

The production Android path remains DashboardActivity → WorldSessionProvider → XboxSignInService → android-friend-world-session.cjs → one authenticated Bedrock client → BedrockGameplayBridge. The CJS scripts directory is the actual Android gameplay path; TypeScript engine modules are not silently promoted into a second runtime.

## 2. New file-by-file structure

| File | Responsibility | Upstream concepts |
|---|---|---|
| scripts/runtime/bedrock/contracts.cjs | Runtime version, bounds and common limits | MinePilot-owned |
| scripts/runtime/bedrock/index.cjs | Create, expose and close extension services | MinePilot integration facade |
| scripts/runtime/bedrock/compatibility/versions.cjs | Project-by-project protocol/runtime matrix | All audited sources |
| scripts/runtime/bedrock/actions/envelope.cjs | Confirmation, freshness, allowlist and control masking | Minecraft AI |
| scripts/runtime/bedrock/actions/outcomes.cjs | Temporal server-postcondition verifier | Minecraft AI |
| scripts/runtime/bedrock/inventory/containers.cjs | Container windows, slot mapping, click plans, ledger aggregation | Bedboo windows/click |
| scripts/runtime/bedrock/navigation/astar.cjs | Binary-heap bounded A* over verified cells | Acacia, 27-7, Baritone, chase-west |
| scripts/runtime/bedrock/planning/goap.cjs | Bounded symbolic goal planning | chase-west |
| scripts/runtime/bedrock/planning/obtain.cjs | Adapts live MinePilot snapshots into Bedboo obtain planner | Bedboo |
| scripts/runtime/bedrock/safety/policy.cjs | Observation-only survival and hazard recommendations | Bedboo safety concepts |
| scripts/runtime/bedrock/tasks/runner.cjs | Serial cancellable bounded tasks with mandatory outcome verification | Bedboo runner, Minecraft AI |
| scripts/runtime/bedrock/learning/curriculum.cjs | Skill progress based only on server-verified success | Voyager |
| scripts/runtime/bedrock/diagnostics/recorder.cjs | Bounded redacted command history | bedrocktool, Minecraft AI episodes |
| scripts/runtime/bedrock/tests/runtime.test.cjs | CJS regression tests | MinePilot |
| scripts/runtime/bedrock/README.md | Package guide | MinePilot |
| vendor/bedboo-agent/planner.cjs | Pinned pure Bedboo obtain planner source | Bedboo commit 1d8d2ae4e7b5c062f71a6373b7aede65d6810bb9 |
| vendor/bedboo-agent/COPYING and COPYING.LESSER | LGPL licence texts | Bedboo provenance |
| vendor/bedboo-agent/NOTICE.md | Origin, pin and integration notes | Bedboo provenance |

## 3. Existing files extended

- scripts/bedrock-gameplay-bridge.cjs: creates the extension facade, exposes runtime status, adds preview-only plan_obtain, records redacted command results, checks manual movement through the action envelope, and closes extensions with the existing session.
- scripts/bedrock-local-path.cjs: preserves MinePilot terrain safety and the route result contract but delegates grid search to the heap A* module.
- package.json: adds runtime tests to npm test.
- README.md and docs/ARCHITECTURE_REBUILD.md: link to this modular structure.

Existing inventory ledger, stack-request manager, recipe catalog, movement controller, Bedboo-derived physics vendor, terrain decoder, gameplay agent, Xbox sign-in, friend-world session and Android application remain canonical. No duplicate client, inventory ledger or movement authority has been added.

## 4. Source-by-source mapping

| Source | MinePilot mapping | Treatment |
|---|---|---|
| Bedboo | vendor/bedboo-agent/planner.cjs; existing vendor/bedboo-physics; runtime inventory, obtain, task and safety modules | Direct pure planner import with notices; coupled Mineflayer files adapted, not copied wholesale |
| Acacia | runtime navigation plus terrain/physics cross-checks | Algorithms/replay reference; Rust client/auth stack excluded |
| 27-7 / bedrockflayer | terrain-cache and registry tests, runtime A* | Palette, block registry and recipe cross-check |
| LeviBatone | Android ARM64 profiling | Native optimisation research only; injected launcher excluded |
| chase-west/minecraft-bot | planning/goap.cjs and navigation/astar.cjs | Planner/navigation concepts adapted; offline desktop connection excluded |
| Ace1928/minecraft_ai | actions/envelope.cjs, actions/outcomes.cjs, tasks/runner.cjs | Portable contracts adapted; Python/Pydantic runtime excluded |
| Voyager | learning/curriculum.cjs and existing Voyager tests | Verified-outcome curriculum; Java/Mineflayer executor excluded |
| ODYSSEY | existing bedrock-odyssey-skill-library.cjs and current 183-entry catalogue | Keep MinePilot's adapted catalogue; no duplicated metadata |
| PrismarineJS bedrock-protocol | existing package dependency, Android runtime and bridge | Kept as the sole protocol client |
| PrismarineJS node-nethernet | existing authenticated friend-world transport | Transport reference; no parallel connection |
| bedrock-rs | protocol and packet cross-validation | Reference implementation only |
| gophertunnel | protocol and packet cross-validation | Reference implementation only |
| Endstone bedrock-protocol | packet cross-validation | Reference implementation only |
| BedrockSharp | packet/codec cross-validation | Reference implementation only |
| CloudburstMC Protocol | packet/codec cross-validation | Reference implementation only |
| Bedwire | low-level transport comparison | Reference only; no Zig runtime |
| Baritone Bedrock | navigation/goal-planning concepts | Algorithm reference; injected DLL excluded |
| Python Baritone port | existing observation/controller separation | Architecture reference; Python runtime excluded |
| bedrocktool | diagnostics and replay-test patterns | Redacted recorder added; no packet injection |
| JNbot Mobile | Android control screens and UX | UX reference; backend protocol not assumed compatible |

## 5. Bedboo integration details

The pure Bedboo obtain planner is pinned to commit 1d8d2ae4e7b5c062f71a6373b7aede65d6810bb9. Its source is kept under vendor/bedboo-agent with COPYING, COPYING.LESSER and NOTICE.md.

Bedboo's inventory_model.js, windows.js, click.js, runner.js and safety.js are coupled to Mineflayer bot, Prismarine Java-layout Window/Item and/or plugin interfaces. Importing those unchanged would not make them compatible with MinePilot's CJS Bedrock client. Their reusable concepts are adapted in the structured runtime modules. The already vendored Bedboo physics remains the implementation used by MinePilot's current movement controller.

The new plan_obtain command reads the existing MinePilot inventory ledger and server-observed recipe catalog. It only returns a proposed dependency plan. It does not mine, gather, smelt, craft or change inventory.

## 6. Single-authority and safety rules

1. The Xbox-authenticated Bedrock client remains the only live session.
2. BedrockGameplayBridge remains the only gameplay dispatch boundary.
3. Existing movement controller, inventory ledger and stack-request manager remain authoritative.
4. Click and crafting plans remain executable:false previews.
5. plan_obtain requires fresh resolved inventory and a fresh observed recipe catalog.
6. TaskRunner requires allowlisted intents, a caller-supplied validated adapter and server-verified completion.
7. OutcomeVerifier ignores client predictions as proof of success.
8. Curriculum records only server-verified success and never auto-starts.
9. Stop commands remain available when other actions are blocked.
10. Diagnostics never retain auth tokens, XUIDs, usernames, raw chat or arbitrary packet payloads.

## 7. Version and device acceptance

The requested target Bedrock 1.26.66.1 is not declared compatible. The current known codec baseline is Bedrock 1.26.60 / protocol 2225. To mark the target supported, require exact-version packet fixtures for PlayerAuthInput, stack responses, containers, subchunks/palettes and block states; Android ARM64 packaging; and a live Xbox/Microsoft friend-world test verifying join, observations, movement, inventory, stop, disconnect and reconnect.

A unit test or successful APK build alone is not enough.

## 8. Tests

- npm test: TypeScript build/tests plus modular runtime CJS tests.
- npm run test:runtime: modular runtime tests only.

## 9. Feature status

- plan_obtain: preview-only Bedboo plan over server-observed MinePilot state.
- Container and click planners: preview-only.
- GOAP: preview-only.
- Manual movement: action-envelope preflight plus existing physics controller.
- A*: heap implementation now backs the existing local-route facade and still requires conservative MinePilot terrain classification.
- Task runner, outcome verifier, curriculum and survival policy: available as modules; no new autonomous gameplay loop is enabled.
