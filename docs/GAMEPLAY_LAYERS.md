# MinePilot Gameplay: Eight-layer integration tracker

**Release strategy:** build/verify the layers in GitHub; no phone installation requested for each layer. One consolidated Android beta is the target, subject to an unavoidable live-friend-world acceptance gate. No claim of autonomous gameplay or working player movement is permitted until host-observed testing.

## Dependency chain

- Foundation PR #88: original standalone companion decisions and movement arbitration; merged to main.
- Gameplay bridge PR #89: one live Android Bedrock session with packets, read-only world telemetry and explicitly gated six-tick diagnostic movement. Draft until real friend-world movement validation.
- Layer 1 PR #90: stacked **on PR #89**, not independently on main. Read-only inventory and critical-health input; structured Inspect, Wait, Stop and guarded Probe tasks; task state, server-position acknowledgement, Android telemetry and tests.
- Layer 2 PR #91: stacked **on PR #90**. Named player tracking and read-only Follow, Stay, Return plans; no automatic following.
- Layer 3 PR #92: stacked **on PR #91**. Read-only item registry, item drops, inventory/pickup correlation, block updates and resource planning; no automatic mining or collecting.
- Layer 4 PR #93: stacked **on PR #92**. Survival priorities, low-air and health emergency preemption, food inventory suggestions and safe task-plan recovery; no automatic eating or combat.
- Layer 5 PR #94: stacked **on PR #93**. Bounded 23-block shelter proposal, server-inventory bill of materials, plank crafting estimates and no-execution Android plan controls.

PRs #89–#94 are staged changes on one Bedrock runtime, not four independent apps. Integrate and retarget the stacked changes in dependency order only when they pass review and the relevant host-observed acceptance gates; do not merge a stacked branch prematurely.

## Cross-phase layers

| Layer | Navigation B | Gameplay C | Intelligence D | Acceptance |
| --- | --- | --- | --- | --- |
| 1 | Navigation authority, stop/short guarded probe | Position/chunk/player/vitals/inventory observation | Inspect/Wait/Stop task states | CI and same-client bridge; physical movement still unverified |
| 2 | Bounded follow/return planning only; normal walking still blocked | Read nearby entity positions + held-tool slot | Follow/Stay/Return plans, cancellation | Unit/integration planning checks; real movement still requires host test |
| 3 | Bounded item/drop and changed-block waypoint previews only | Observe item registry, item entities, block updates and inventory; no mining | Resource goals and server pickup/inventory correlation | Unit/integration observation checks; real collection still blocked |
| 4 | Critical-vitals stop gating; hazard terrain avoidance deferred | Read-only food and air/time observations | Pause tasks and offer recovery-to-planning state, no automatic eating | Health/air/survival CI; real hazard handling deferred |
| 5 | Fixed shelter waypoint proposals; collision unknown | Inventory-backed plank estimates and 23-block blueprint; no crafting or placing | Switch safely between shelter/crafting and prior goals | BOM tests and packed same-client tests; action verification deferred |
| 6 | Better pathfinding, water modes, local replan | Farming and chest operations | Checkpoints, retries and task graph | Multistep task survives interruption |
| 7 | Safe bounded exploration | Combine verified survival/gather/build skills | Persistent skill journal and optional model planning | Approved skill sequences with independently checked outcomes |
| 8 | Movement and runtime profiling | Integrated regression across all verified interactions | Harden task planner, Android UI, diagnostics | Consolidated beta candidate; host and device acceptance |

All layers include tests; they do not each imply an APK release. The 8-layer breakdown is an engineering estimate and can evolve if protocol or OS changes force a different split.

## Layer 1 contract

Action schema: `minepilot.gameplay.v1`, one command at a time, unique request ID, active Android session only.

- `status`: read-only snapshot; no Minecraft packets sent.
- `inspect`: records an inspection goal and reports whether position/spawn data was available. Returns warnings for low health/hunger; it does not assume visible chunk headers are decoded blocks.
- `wait`: holds manual navigation authority and stops any current experimental movement input. No automatic pathfinding.
- `stop_movement`: cancels movement and goal. A health safety hold cannot be dismissed by a stop command.
- `probe_step`: still disabled by default and separately confirmed in the app. Allocates manual navigation authority only if world state and safety gates permit. **Accepted** means an experimental input packet was queued. It moves to `awaiting_server_verification` and only records `completed` if a later server-reported position differs by at least 0.12 blocks; timeouts are `unverified`. This server displacement can also be caused by gravity or knockback, so host-side testing is still necessary to prove causality.

World observations are bounded and not persisted as private raw protocol dumps. Inventory readout counts only valid, server-reported player slots; it cannot yet equip, eat, craft, mine or manage containers. Survival hold stops movement but does not invent a real eat action. All work remains original and clean-room, with uploaded addon behaviors used only as feature references.

## CI and beta acceptance gates

1. `npm test` TypeScript unit tests and live-client bridge fixture tests.
2. Packaged Bedrock SDK smoke tests against protocol 2225 serializer with encoded auth-input fixtures.
3. Android Node Runtime Probe builds and packages the TS gameplay ESM modules, plus CJS bridge.
4. No unexpected changes in Microsoft/Xbox authentication, world discovery, NetherNet join/spawn, SDK tests or Android Shell APK.
5. Before enabling normal movement, host verifies a short movement and stop command in a private flat world, observes exact player coordinates, detects no significant rubber-banding or disconnect, and confirms input fixes. A compiled APK or successful packet queue **cannot replace** this.
6. No phone installation is requested until a consolidated milestone is testable. Development can continue on GitHub; any remaining real-device blocker must be documented rather than silently bypassed.

**Feature status:** Layers 1–5 implement observation and goal-planning infrastructure, not autonomous Minecraft gameplay. Their combined physical gameplay acceptance remains blocked on a verified server-authoritative movement driver, decoded voxel collision and actual block/item interaction. See docs/GAMEPLAY_LAYER_2.md and docs/GAMEPLAY_LAYER_3.md.
