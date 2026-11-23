# MinePilot — Real Bedrock Autonomy Runtime, Phase A

## Why this PR exists
The user tested the previous ARM64 debug APK in a friend's Xbox Bedrock world. The bot joined but did not move, interact or attract hostile mobs. Earlier layers supplied advisory goals but no verified terrain-driven action loop. This PR provides actual packet-producing, **opt-in bounded navigation** on top of the preserved working friend-world connection and continuous neutral input fixes from PR #102.

## What upstream projects contributed to the design
- `giaffa86/mineflayer-for-bedrock-nethernet`: 20Hz PlayerAuthInput physics, XZY palette-based SubChunk storage, dynamic collision and world updates. Its client/session layer is **not** installed because MinePilot must keep its working Xbox friend-NetherNet handshake.
- `LiteLDev/bedboo`: operational separation of Bedrock physics, block palettes, pathfinding and action plugin interfaces. Bedboo is Node >=24 and its source uses monorepo/pnpm patches, so a drop-in replacement would jeopardize the 8GB Android target.
- `inuttan/27-7`: Bedrock Mineflayer-like chunk parsing, player tick movement and plugin architecture. Its README documents the architecture but not host-specific runtime verification.
- Mojang's 1.26.60 `packet_level_chunk`, `packet_subchunk`, `packet_player_auth_input`, and `packet_update_block` schema.

## Implemented, deployed to the Android Node runtime
1. `scripts/bedrock-terrain-cache.cjs`: bounded network-palette SubChunk v8/v9 decoding for complete positive-count LevelChunk payloads and SubChunk responses, sparse update_block cache, server-declared all-air sections, transactional parse, error/cached-blob rejection. 256-section and 4096-update cap, 2 MiB per payload limit. Missing sections return null, not air.
2. `scripts/bedrock-runtime-registry.cjs`: resolve vanilla 1.26.60 network block state IDs against exact-version `minecraft-data.blocks` min/max StateId ranges and full-cube bounding box. Refuse custom server block palettes, unknown engine versions or incomplete data. A decoded runtime ID alone is **not proof** of safe ground.
3. `scripts/bedrock-local-path.cjs`: bounded A* (max 256 nodes, 12-block radius), on one trusted Y level only, requiring known solid ground, two known air blocks above and no adjacent lava/fire/water; unknown or partial blocks fail closed.
4. Existing `BedrockGameplayBridge` observes real chunk payloads, subchunk replies and update_block packets from its authenticated client; resets caches on world/dimension changes. It feeds a verified waypoint into the Layer 2 Follow/Return goal and addon-navigation authority rather than setting `collisionVerified:false` unconditionally.
5. `ExperimentalPlayerInput.runVerifiedStep`: **real outbound Bedrock PlayerAuthInput** to one verified waypoint, capped at 8 ticks by default, <=12 max, <=2.1-block range, and caller-verified safe terrain. Disabled unless the user explicitly enables experimental movement.
6. `VerifiedAutonomyRunner`: a 250 ms bounded Follow/Return supervisor that requests at most 20 steps or 30 s of total activity. Each short 8-tick pulse must be followed by fresh server-reported movement >=0.08 block; otherwise the runner stops within 4 s. Never assumes that sent packets are accepted.
7. Android Command Center has explicit confirmation dialogs for `verified_step` and `autonomy_follow`, a separate `autonomy_stop`, terrain coverage/registry/A* status and attempted-vs-server-confirmed steps. All commands are filtered by a private IPC allowlist.
8. Packaged Node SDK runs offline terrain/A* and runner regression tests. Unknown data, lava, corrupt palettes, custom registries, critical health, inactivity and missing authority all reject or stop actions.
9. `scripts/bedrock-block-break.cjs`: one manually confirmed, nearby solid-block break interaction. Start/continue/stop actions are inserted into the existing 20Hz PlayerAuthInput stream using Bedrock InputData 35 and optional `block_action` entries. A change to the exact observed target block on the same dimension is reported as `server_block_changed_causality_unverified`, never guaranteed successful mining. Hard cap 24 continue frames and six-second timeout; Stop/close/dimension/authority changes abort. Android presents a coordinate-validated explicit confirmation dialog.
10. Packet serializer regression tests verify that the real staged Bedrock 1.26.60 SDK accepts block-action frames; future automated mining must not start until actual host behavior and item drops are independently checked.

## What this PR does NOT claim
- It does not establish that the Xbox friend-hosted world accepts MinePilot as a real Survival player; only the user's phone and server can verify that.
- It does not implement unrestricted exploration, jumping over unknown blocks, stairs/slabs, swimming, **autonomous** mining, crafting, building, combat or inventory transactions. A single confirmed block-break diagnostic exists but is not proof of actual server-side mining.
- It does not mean Live autonomy is verified; the readiness gate must remain false until on-device telemetry proves movement, terrain decoding and action consequences.
- Experimental tests can move the character unexpectedly. Only use in a flat, private, safe friend world; test bots in Survival and note game mode, heartbeat frames, decoded sections, classified block registry, verified route and corrected movement.

## Beta acceptance test
1. Install the **full** ARM64 Node-runtime APK artifact (not the shell APK). Connect as usual.
2. On Command Center verify the server mode is Survival, 20Hz neutral presence frame count increases and the block registry loads. Record decoded sections (0 means world has not delivered parseable block data).
3. Enable experimental movement before joining. Select Follow for a visible player standing on flat ground within 9 blocks (same height).
4. If route status is `route_found`, click 'Try one verified-terrain walking step' and record actual host-observed movement. Follow with the explicitly confirmed bounded autonomy button.
5. If the host does not echo position updates, autonomy stops as `server_movement_not_confirmed`; this is intentional, and the bot must not continue guessing. Capture redacted telemetry so the next protocol correction is based on a real host.

## Research references
- https://github.com/giaffa86/mineflayer-for-bedrock-nethernet
- https://github.com/LiteLDev/bedboo
- https://github.com/inuttan/27-7
- https://mojang.github.io/bedrock-protocol-docs/1.26.60/packets/player-auth-input-packet/