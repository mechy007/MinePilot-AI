# MinePilot — Layers 1–8 and consolidated beta acceptance

The eight code-integration layers add a same-session Bedrock gameplay bridge, observations and task plans, resource/survival/building proposals, verified-grid navigation planning, farm/storage previews, a suggestions-only advisor, and an Android readiness gate.

**These are code milestones, not proof of autonomous gameplay.** A passing SDK test or APK build does not prove Minecraft will accept physical movement, block transactions, crafting or survival skills.

## No-reinstall strategy

Develop through stacked draft PRs #89–#97 with CI on each. Do not request a phone installation after each layer. Produce one signed consolidated release candidate only once there is a meaningful playable milestone and physical-host testing can be scheduled. Do not merge stacked PRs out of dependency order.

## Layer 6: navigation and multi-step workflow

- Bounded A* requires separately verified walkable grid cells; unknown terrain is impassable. Current Bedrock chunk headers are NOT decoded voxel/collision data.
- Read-only external container slot counts and farm-related block update observations. No chest transactions, harvesting, watering or item insertion.
- Farm/storage/collection workflow previews have checkpoints. Observation steps can be reviewed; terrain and recipe steps block until real verification/executors are implemented.
- No automatic movement is sent.

## Layer 7: companion advisor

- Offline original deterministic policy, off by default and explicitly enabled for suggestions.
- Safety first, then food, interrupted-task review, route or materials review, and inspection.
- Maximum 32 whitelisted action/reason/time records kept in RAM for this session; turning the advisor off clears them.
- No remote LLM, game actions, packet injection, automatic crafting, mining or combat.

## Layer 8: beta readiness and hardening

- Fresh spawned bot position and chunk headers are required for a new planning request; position observation older than 30 seconds is considered stale. Stop is allowed even when stale.
- Android reports planning status and physical QA blockers instead of misleading completion badges.
- Beta readiness remains FALSE until independently verified actual movement, terrain collision, block/item interactions and device foreground reliability.
- CI checks include Engine CI, Bedrock SDK Smoke, Bedrock Connection Validation, Android Shell APK and Android Node Runtime Probe with same-client fixture tests.

## Real-playable acceptance blockers

1. Stable PlayerAuthInput 20 Hz control/stop, yaw, jumping, physics and server correction acceptance in a friend-hosted world.
2. Actual loaded voxel decoding, safe pathfinding and hazard avoidance.
3. Server-acknowledged mining, placement, inventory, equipment, food and crafting transactions with permission, retry and range checks.
4. Verified skill execution and user approval over optional autonomy, plus hard survival stop.
5. Vivo V2544 8 GB Android lifecycle, background foreground-service notification, screen-off, disconnect/reconnect and battery tests.
6. Reconcile stack in dependency order with no regressions, then produce one approved signed build.

**Eight out of eight code-integration layers does NOT mean eight out of eight functional game skills, nor a finished autonomous bot.** This is the infrastructure foundation for the next verified physical gameplay milestone.