# MinePilot-AI Unified Gameplay Engine — Implementation Blueprint

Status: engineering design and phased integration plan, not a statement of implemented features.
Updated: 2026-11-23.
Target: Android ARM64 (Vivo V2544, 8 GB RAM); Xbox friend-hosted Minecraft Bedrock 1.26.66.1.
Foundation branch: feature/gameplay-companion-foundations, draft PR #88.

## Executive decision

Build one independent player runtime, not a bundle of addon-script bots. Keep the working Xbox/NetherNet joining process intact, add a server-authoritative gameplay transport, and layer a world model, an exclusive action/movement coordinator, goal-driven skills, safety, memory and optional LLM planning above it.

Reported manual device verification: login, spawn, and sustained connected state for over one minute. These observations are user reported. The current source README does not yet record these live test results. Longer sessions, screen-off behavior, gameplay and full protocol interoperability remain to be measured.

## Audited inputs and licensing

1. AI Player+ v3.0 uploaded package: behavior pack and resource pack; 36 archive entries, one 64 KB JavaScript main script; @minecraft/server 1.15.0 and @minecraft/server-ui 1.3.0. Manifest explicitly says All Rights Reserved - GURJAR. The addon controls a custom scripted entity through the world API and provides 25 menu entries. Do not copy its source, models or textures without permission.
2. AI Multiplayer v1.9 uploaded package: 180 archive entries, 53 JavaScript files; @minecraft/server 2.12.0-beta and UI 2.0.0. The manifest does not establish a general reuse license. Treat as reference only until rights are verified. Most behaviors control custom entities, use direct entity properties, impulses, teleports, world writes and privileged commands.
3. MinePilot source: Android DashboardActivity and world-session provider, scripts/android-friend-world-session.cjs, src/core/bot-runtime.ts, src/core/agent.ts, src/core/bot-awareness.ts, src/minecraft/prismarine-runtime-adapter.ts and move-player-writer.ts. Current Android friend-world runner observes spawn/chunks/session and does not yet execute the TypeScript gameplay planner in the same live connection. The move-player writer deliberately rejects non-verified legacy movement.
4. Public technical references: Mojang Bedrock protocol docs, PrismarineJS bedrock-protocol and Mineflayer, bedboo, prismarine-bedrock movement documentation, Mojang item-stack requests, Voyager skill library and Android official foreground service documentation. bedboo is LGPL-3.0-only; importing it requires license compliance and its use with Xbox friend-hosted 1.26.66.1 is not verified.

No addon implementation, assets or proprietary names are to be merged directly into MinePilot.

## Unified architecture

Android UI -> Android session/command provider -> same live Node Bedrock session -> server-authoritative packet adapter -> world state store.
World state store -> safety supervisor -> task/goal planner -> movement/action authority -> protocol adapter.
World state store -> companion personality/social memory -> text command interpreter -> task/goal planner.
Optional LLM -> schema-validated goal suggestions ONLY -> deterministic planner and capability/security gate.
Every executed action -> server observation -> confirmation or corrective recovery -> task journal -> Android progress UI.

Exactly one authenticated live Bedrock client and one write pathway may exist per bot session. Do not let separate services connect or send conflicting movement packets.

## M0: join-to-gameplay bridge (non-negotiable)

- Preserve the user-verified Xbox authentication, friend world selection, NetherNet handshake and login/spawn path.
- Add gameplay-ready gating after join/start_game with valid entity runtime id, dimension, position, protocol negotiation, and initial world observations.
- Surface the existing live client as a capability-scoped session adapter to the gameplay engine instead of creating a second client.
- Commands and snapshots should travel through an authenticated, process-local Android-to-Node IPC channel. Use a monotonically increasing sessionId and commandId, versioned schemas, bounded message sizes and an acknowledgement stream.
- Only the active session owner may send actions. Disconnect, account switch or session generation change must cancel all pending tasks, clear movement requests and close listeners.
- Report states: authenticated, joining, spawned, world_syncing, gameplay_ready, degraded, reconnecting, disconnected. Spawned alone is not gameplay_ready.
- Expose explicit per-capability state: unknown, unsupported, available, verified_on_device. Buttons must not advertise a verified action until the underlying transport and end-to-end outcome pass.

Acceptance: current join remains working; an Android command reaches the same live session; stop cancels it; errors are sanitized and no credential reaches activity logs.

## M1: Bedrock protocol correctness

Movement:
- Read movement authority and initial server tick from StartGame; track own entity and dimension. Seed client tick from server state, advance against monotonic elapsed time and re-anchor on authoritative correction.
- Implement PlayerAuthInput (packet 144 for the protocol family) with correct version-specific serializer, orientation, analog motion, input flags, jump/sprint/sneak, predicted position, velocity and tick. Do not use move_player as a workaround when the server requires server-authoritative input.
- Maintain a 20 Hz input/physics schedule, but account for Android/Node event-loop delays, missed frames and tick rewind windows. Do not assume timer callbacks happen exactly every 50 ms.
- Run local physics prediction with collision boxes, gravity, drag, fluid and friction appropriate to the negotiated Bedrock family. Apply correct_player_move_prediction and other authoritative corrections. If corrections repeatedly disagree, stop movement and resynchronize.
- One camera/look authority, with yaw/pitch and look-at conversion compatible with Bedrock orientation.
- Serialize inventory and block actions on the appropriate tick and transaction pathway when authority requires it. No teleport, creative-only, world-edit or operator action is a substitute for player mechanics.

Acceptance: walk/stop/turn/jump/sprint without rubber-banding over a sustained session; server-observed displacement matches command; corrections converge; disconnect and emergency stop cease input.

## M2: world model and observations

Maintain a time-stamped and versioned WorldSnapshot containing:
- Player: UUID/XUID where available, own runtime id, position, velocity, yaw/pitch, dimension, on-ground/in-water, game mode, status effects, health/max health, hunger, air, armor, equipment, death state.
- Terrain: chunk/subchunk cache, runtime-id palette mapping, block states and collision boxes, height/standability, light, fluids, lava, fire, cactus, powder snow, fall/void exposure, block update history.
- Entities: other players, host identity, trusted identities, mobs, dropped items, projectiles, distance/line of sight, last-seen position and update time.
- Inventory: slots/hotbar, stacks, item network ids, tool durability and equipment, open window/container id, recipe knowledge and crafting station access.
- Environment: weather, daytime/night, biome, shelter, known doors/crops/chests/bed/workbench/furnace, hostile density, safe-home coordinates.
- Confidence and freshness: unknown block remains UNKNOWN, not air. Every observation carries source and age; outdated state cannot authorize block breaking, combat or risky traversal.

Decode level_chunk/sub_chunk updates, update_block, start_game, move_player/add_player/add_actor/remove_actor, update_attributes, inventory_content/slot, mob equipment and relevant correction packets. Handle palette hashes, cache misses and dimension changes.

Memory tiers: short-lived local voxel cache; current-task context; persistent landmarks and learned successful skill parameters. Persist only safe, non-secret metadata and world identifiers.

Acceptance: display own coordinates and nearby players, resolve a standable route from observed chunks, handle dimension switch and unknown/unloaded chunk edges safely.

## M3: exclusive movement/navigation authority

Original MinePilot class NavigationAuthority in src/gameplay/navigation-authority.ts starts this layer. It currently selects intent; it does not move a real client.

Priority ladder: emergency stop 100 > survival/escape 90 > explicit user/manual 80 > combat 70 > active task 60 > follow 50 > exploration 30 > idle wandering 10.
- Requests have owner, target, mode, hold/aim state, TTL, reason and cancellation token. Only winner controls yaw, movement and jump for the current tick. Expired or orphaned commands release ownership automatically.
- Emergency stop is sticky until explicitly cleared. Ownership is canceled on disconnect, death, dimension changes and task generation change.
- Prohibit moves into unloaded cells or known lethal hazards unless explicit safe traversal exists.
- Navigation: bounded A*/Dijkstra over standable voxel nodes, dynamic replanning; climb/jump/safe-drop/swim/boat mode transitions; avoid lava, cliffs, deep water and hostile mobs; plan bridges/mining only through authorized action skills.
- Two-layer control: global route/waypoints at low frequency, local steering plus obstacle/velocity corrections at tick frequency.
- Stuck detection: low observed displacement for requested movement -> pause -> local sidestep -> replan -> request user intervention, with bounded retries; never infinite teleport loops.
- Follow: user-selected XUID, line of sight, comfortable distance 2-4 blocks, catch-up sprint, loaded-world boundary, stop at distance, re-anchor target identity after reconnect.

Acceptance: follow a named visible player for at least five minutes over turns and simple obstacles; stop in one tick of command receipt; unknown chunk and high-risk traversal fail safely.

## M4: reliable action and inventory transactions

Every skill follows VALIDATE -> RESERVE -> EXECUTE -> OBSERVE -> VERIFY -> COMMIT or RECOVER.
- Movement: confirm real server position before declaring destination reached.
- Mine: check observed target and reach, face block, select correct tool, initiate server-authoritative break intent, respect time/harvest rules, observe update_block, then collect drop and verify inventory. Never fabricate mined resources.
- Place: confirm slot possession, permitted surface and reach; send version-correct item_use / input action; verify block update and stack decrement. Never place via setType/privileged /setblock.
- Inventory: implement container open/close and server-authoritative ItemStackRequest with net ids; handle responses, rejected requests, slot corrections, inventory resync. Do not treat UI predictions as inventory truth.
- Craft: recipe dependencies, stations, tool/material validation, recipe network ids, request/response and slot verification.
- Combat: hostile-only and user-configured targets by default; path, aim, weapon/equipment/cooldowns, attack through ordinary player mechanics, verify target damage/death, defensive retreat.
- Farm: detect mature crops, harvest, reserve replanting seeds, till/plant/replant, verify world and inventory changes.
- Build: blueprint -> materials bill -> authorized work area -> collision/placement sequence -> verified blocks -> checkpoint/recover; keep original terrain and protected areas respected.
- Storage: designated chest locations, ownership/permissions, slot transactions, receipts; no item duplication or silent disappearance.

Acceptance: a real block is broken/placed and confirmed from server updates, tools and inventory counts reconcile, failure/reject handling preserves world safety.

## M5: task graph and autonomous planning

State machine: queued, validating, waiting_for_world, waiting_for_resources, executing, verifying, completed, failed, cancelled, paused_by_safety.
- Goal -> task graph -> skill calls with typed preconditions, postconditions, timeouts, idempotency keys, retry budget, reversible compensating steps and progress checkpoints.
- Work order priorities: immediate hazard -> user stop -> rescue/follow/guard commitments -> resource gathering -> queued crafting/building/exploration -> social/idle.
- Interrupt and resume: save task cursor and resources; resume only after new world snapshot, permission/ownership check, fresh inventory and target validity.
- Reason and task history are small structured events, not giant raw chat dumps.
- Skill examples: follow(host); return(home); cut_tree(count); mine(block,count); harvest_and_replant(field); eat_if_hungry; craft(recipe,count); build(blueprint,anchor); deposit(chest,items); defend(hostile); light_cave; seek_shelter.
- For user intent 'Build a hut': choose site -> verify bounds -> gather needed logs/stone -> craft planks/tools -> path to site -> place layers -> count verified blocks -> report leftovers. Ask for approval before destructive clearing.

Acceptance: complete a multi-stage task with correct inventory changes and recover from one known interruption.

## M6: survival and companion behaviors

Source-inspired skill families:
- AI Player+: follow/stay/patrol, equip/unequip, guard, chop logs, mine stone/ores, crop harvest/replant, clear grass, torch management, hut/bunker/campfire/bridge presets, item pickup, backpack, simple recipes, give/receive loot, emotes and companion identity.
- AI Multiplayer: survival brain, terrain avoidance, water escape, fall prevention, night camp, shelter, movement priorities, task worker, builder, goal system, companion quests, food, item pickup, combat tactics, conversation/social memory, weather, mounts, duels, factions, mood and settings.
- Real player replacements: food is consumed from actual slots; armor and weapons have real durability; shield/combat uses legitimate controls; builders spend actual blocks; sleeping requires usable bed and in-game conditions; real emotes use supported player actions or app UI (custom addon animations cannot be injected into unmodified worlds).
- Non-portable features must be optional or omitted: instant world editing, applyDamage direct, instant healing buffs, free materials, forced teleports, flying in survival, shockwave knockback, vanish, private commands, custom custom-entity animations, or running Minecraft Script API directly from the remote client.
- Advanced/PvP behaviors like duels, mischief, stealing or faction wars are disabled by default and require host-aware permissions; never attack ordinary players automatically.

Acceptance: low health or hostile threat preempts mining; enough food is present before eating; guard recognizes trusted players; tasks do not perform forbidden world modifications.

## M7: natural language, memory and optional small AI

- First ship deterministic command parsing with an allowlisted schema: follow, stop, wait, return, mine, gather, craft, build, explore, protect, deposit, status.
- An optional Qwen-compatible local or hosted planner may translate a goal into the same structured task schema; the model never sends raw protocol packets, untrusted JS, server commands or arbitrary Android IPC.
- Intent validator checks actor, capability, user consent, target identity, coordinates, task limits, dimension, materials and safety. Require approval for destructive mining/building near protected builds and PvP.
- Keep AI reasoning event-driven at seconds/minutes granularity, not 20 times per second. Deterministic physics and survival use fast local code. On 8 GB Android, 4B-class models can compete with the Node runtime for RAM and thermals; provide a rules-only fallback and test local inference under realistic memory pressure.
- Use a skill journal and retrieval of successful task parameters, failure reasons, landmarks and preferred playstyle. Avoid storing access tokens or raw third-party chat by default.

Acceptance: 'follow me', 'collect ten logs and bring them back', and 'build a small shelter' parse to authorized, inspectable tasks; if LLM is offline the bot still functions.

## M8: Android UX and background reliability

- Command Center: current server/session, last server-verified position, health/hunger, task queue, task stage, live navigation owner, inventory summary, capability status, event log, pause/resume, immediate STOP.
- Task composer: templates and natural-language prompt, limits for count, area and material budget, preview before changing a friend's world, explicit approval where required.
- Android service: foreground notification and user-initiated start/stop; keep connection processing separate from UI thread; recover process errors without losing encrypted credentials.
- Choose a lawful foreground-service type for the actual use case; Android 15/16 impose restrictions and timeouts on dataSync; do not claim an unrestricted always-running app. Test battery optimization, notification permission, Doze, network handoff, Android kill, screen lock and thermal pressure on the physical device.
- Connection recovery: classify transport vs host closed vs auth expired; retry with a capped backoff only while host's world is available and user requested a persistent session; no reconnect loops after explicit stop.
- Limits and instrumentation: rolling bounded logs, bounded chunk LRU by spatial vicinity, spatial entity index, serialized writes, coalesced UI updates and counters for tick delay, heap, CPU time, packet lag, correction rate and task retries.
- Suggested starting cadences (to tune, not performance claims): packet/physics inputs 20 Hz; local obstacle probes 5-10 Hz; higher-level route replan 1-3 Hz; survival assessment 1-2 Hz; app UI 1 Hz; LLM only on new goals or material changes.

Acceptance: background task and notification work while screen is locked where OS permits; explicit stop tears down everything; 30/60-minute live soak tests report resource measurements.

## Workstream map and source traceability

| Workstream | Addon references | MinePilot implementation |
| --- | --- | --- |
| Controller / priority | AI Multiplayer ai_navigation.js, ai_goals.js | navigation-authority, task scheduler, emergency stop |
| Physics / traversal | ai_player_physics.js, ai_sprint_jump_builder.js, ai_pathfinding_tweaks.js | auth-input writer, physics, voxel pathfinder |
| Obstacles / hazards | ai_water_escape.js, ai_trap_proof.js, ai_obstacle_breaker.js, ai_fall_detector.js | world collision and safety checks |
| Mine / gather / farm | AI Player+ task modes, AI Multiplayer ai_task_worker.js | material planner, verified mining/farming |
| Building | AI Player+ hut/bunker/bridge presets, AI Multiplayer ai_builder.js, ai_shelter_builder.js | schematics, block budget, placement verification |
| Inventory / crafting | AI Player+ backpack and recipes, AI Multiplayer eat_food.js | native player inventory, ItemStackRequest and recipes |
| Fighting / defense | AI Player+ auto-combat, AI Multiplayer ai_combat_tactics.js, ai_combat_combos.js | target selection, normal player attacks, damage verification |
| Survival / camp | AI Multiplayer ai_survival_brain.js, ai_night_camp.js, ai_torch.js, ai_environment.js | survival interrupts, light/food/weather/shelter |
| Social / tasks | AI Multiplayer ai_bot_quests.js, ai_social_memory.js, ai_conversations.js | quest graph, text command system, memory |
| Friends / safeguards | AI Multiplayer ai_bot_friendships.js, ai_interaction_ui.js | trusted XUID allowlist and command permissions |
| Cosmetic behavior | AI Player+ emote menu and resource pack | native game actions where supported; Android UI otherwise |

## Recommended repository layout

- src/gameplay/session/ : same-session live bridge and capability registry
- src/gameplay/world/ : chunks, blocks, entities, inventory and snapshot freshness
- src/gameplay/protocol/ : versioned PlayerAuthInput, corrections and inventory writers
- src/gameplay/navigation/ : authoritative controller, voxel search and stuck recovery
- src/gameplay/tasks/ : goal graph, preconditions, checkpoints, receipts and recovery
- src/gameplay/skills/ : move, follow, gather, mine, craft, build, fight, farm, deposit, survive
- src/gameplay/brain/ : deterministic priorities, memory and optional LLM adapter
- src/gameplay/policy/ : trusted users, protected areas, safety and permissions
- src/gameplay/telemetry/ : task events, performance and troubleshooting
- Android: keep auth/session integration in existing app; add versioned commands and capability-aware controls.
- Existing src/gameplay/companion-engine.ts and navigation-authority.ts from PR #88 are decision-layer starting points, not live action executors. Avoid a second parallel planner long-term: integrate them with src/core/agent.ts and Android GameplayPlanner.

## Test and acceptance ladder

1. Pure unit tests: decision priority, TTL, cancellation, path planning, hazard classification, task graph, inventory ledger, serialization validation and model output rejection.
2. Protocol fixtures: captured sanitized 1.26.60/2225 packets, StartGame tick, auth-input shape, correction re-anchor, chunk updates, item request success/reject.
3. Local BDS integration: 20 Hz movement, stop, follow, teleport correction, falling/water, block break and placement, item-stack response, craft/smelt.
4. Xbox friend-world device validation: bot visible to host, login/spawn, server-observed position after commanded walk, follow/stop, mine/place, inventory change; do not equate BDS pass with friend world pass.
5. Android instrumentation: app background/foreground, 30- and 60-minute connection stability, host closes world, network handoff, battery mode, memory and thermal conditions; check explicit consent and account separation.
6. Autonomous scenario: 'join -> follow host -> collect logs -> craft planks -> build a hut -> deposit remainder -> return -> wait', with complete task receipts and bounded failures.

Definition of done: 'complete' means the bot executed an action as an ordinary, authenticated Minecraft player, the host/server observed it, the client reconciled authoritative state, and test evidence is recorded. A UI button, packet queued, parsed goal or successful APK build is not proof.

## Delivery order and dependency gates

Phase 1 (blocking): Same-session Android bridge + PlayerAuthInput writer + authoritative corrections + world snapshot + emergency stop.
Phase 2: Grounded coordinate walking, turn/jump, navigation ownership, following, unloaded chunk guards, stuck recovery.
Phase 3: Live inventory and block state, verified mine/place/pickup/eat, craft and container transactions.
Phase 4: Follow/guard/survival modes, farming, building presets, combat and night shelters.
Phase 5: Structured multi-step plans, checkpoint memory, trust and permissions, optional Qwen reasoning.
Phase 6: Advanced mounts/social/quests/personality, Android profiling and full live test matrix.

Do not merge a phase solely on green unit tests. Verify gameplay actions with live world outcomes before enabling the related Android buttons.

## External technical references

- https://mojang.github.io/bedrock-protocol-docs/latest/
- https://mojang.github.io/bedrock-protocol-docs/guides/block-breaking-overview/
- https://mojang.github.io/bedrock-protocol-docs/1.26.60/packets/item-stack-request-packet/
- https://github.com/PrismarineJS/bedrock-protocol
- https://github.com/LiteLDev/bedboo (LGPL-3.0-only)
- https://github.com/PrismarineJS/mineflayer/issues/4145
- https://github.com/deepslate-bedrock/prismarine-bedrock/blob/main/docs/reference/auth-input-and-movement.md
- https://voyager.minedojo.org/
- https://developer.android.com/develop/background-work/services/fgs/service-types
