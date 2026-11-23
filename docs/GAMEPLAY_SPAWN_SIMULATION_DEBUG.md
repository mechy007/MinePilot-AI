# MinePilot — Spawn/Simulation Handshake Debugging

## User's physical-world report (23 Nov 2026)
The Android bot joins an Xbox friend's Minecraft Bedrock world but does not move or perform actions; hostile mobs do not attack it. This may indicate incomplete server player simulation, Creative/Spectator game mode, missing loading-screen completion, or rejected movement input. The report does **not** by itself identify the root cause.

## Protocol-grounded investigation
- PrismarineJS bedrock-protocol autoInitPlayer emits the spawn event and sends set_local_player_as_initialized when the host reports play_status player_spawn. The old MinePilot code interpreted that event as complete in-world simulation.
- On a Bedrock Dedicated Server 1.26.51 implementation, client respawn state 1 requires state 2 acknowledgment, and a pair of serverbound_loading_screen packets (types 1,2) is required before player_auth_input affects server simulation. The Xbox friend host may differ.
- Pinned PrismarineJS minecraft-data Bedrock 1.26.60 includes respawn state and serverbound_loading_screen schemas, and GameMode values including fallback (world mode), creative and spectator.
- Hostile mobs typically ignore Creative/Spectator players; other AI conditions also matter. This behavior alone does not prove the bot is ghosted.

## Implemented diagnostic/fix
- Read player_gamemode and world_gamemode from StartGame, resolving fallback to the world mode. Track difficulty, changes to the local player's game mode and movement authority.
- Respond once per received respawn state 1 with the bounded state 2 reply and update current reported coordinates.
- On the SDK spawn event, queue serverbound_loading_screen type 1 and type 2 exactly once per world/dimension. The SDK's existing set_local_player_as_initialized behavior remains unchanged.
- Retain no automatic movement: input is still opt-in and manually confirmed. Expose packet count and handshake errors, not false server acknowledgment.
- Android shows effective game mode, world difficulty, movement authority, loading-screen packet submission and respawn acknowledgments.
- Bridge fixture tests assert ordering, reset and deduplication, mode isolation and no unsolicited gameplay packets.

## Verification and next physical test
Rebuild and test the Android ARM64 friend-world app from this PR (stacked on PR #98). After joining, report effective game mode (Survival expected), loading handshake sent, movement authority and handshake errors. Observe whether the host now simulates the bot as an active player. Use the existing short opt-in movement diagnostic if safe.

Hostile mob aggro is **not** a recommended primary safety test. A safer test is the host changing the bot to Survival, verifying ordinary interaction/hurt in a controlled area and verifying server movement/correction telemetry. Do not intentionally expose the bot to lethal attacks.

Do not merge as a proven fix until on-device host verification. The actual Minecraft host may use a different loading screen lifecycle. This patch does not implement mining, crafting, autonomous following or fully collision-aware movement.