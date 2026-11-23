# MinePilot Gameplay: Eight-layer integration tracker

**Release strategy:** build/verify the layers in GitHub; no phone installation requested for each layer. One consolidated Android beta is the target, subject to an unavoidable live-friend-world acceptance gate. No claim of autonomous gameplay or working player movement is permitted until host-observed testing.

## Dependency chain

- Foundation PR #88: original standalone companion decisions and movement arbitration; merged to main.
- Gameplay bridge PR #89: one live Android Bedrock session with packets, read-only world telemetry and explicitly gated six-tick diagnostic movement. Draft until real friend-world movement validation.
- Layer 1 PR #90: stacked **on PR #89**, not independently on main. Read-only inventory and critical-health input; structured Inspect, Wait, Stop and guarded Probe tasks; task state, server-position acknowledgement, Android telemetry and tests.

PR #90 is not a second app and does not create another Bedrock connection. When #89 is integrated, retarget #90 to main or merge the changes into the same implementation branch after review. Avoid merging a stacked branch directly to main before its base is ready.

## Cross-phase layers

| Layer | Navigation B | Gameplay C | Intelligence D | Acceptance |
| --- | --- | --- | --- | --- |
| 1 | Navigation authority, stop/short guarded probe | Position/chunk/player/vitals/inventory observation | Inspect/Wait/Stop task states | CI and same-client bridge; physical movement still unverified |
| 2 | Deterministic walk, facing, jump and bounded follow | Read nearby entity position + held-tool slot | Follow/Stay/Return, cancellation | Host sees repeatable normal movement; server corrections converge |
| 3 | Approach resource with loaded chunk awareness | Break simple block, pickup and inventory reconciliation | Gather N target resources | Server confirms block and inventory changes |
| 4 | Hazard avoidance / stuck recovery | Food detection and equipment switching | Pause task for survival, resume when safe | Safe interleaving and honest failures |
| 5 | Navigate materials/work area | Craft simple recipe and place verified blocks | Plan one small shelter with approval | Actual bill of materials and placed blocks confirmed |
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

**Feature status:** Layer 1 is a vertical integration framework, not completed autonomous Minecraft gameplay. The next layer must replace the diagnostic pulse with real server-authoritative, collision-aware movement verified on an actual host.
