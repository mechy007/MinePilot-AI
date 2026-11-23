# Bedrock 1.26.60 — Continuous Player Presence

## Physical issue
The user confirmed an Xbox friend-hosted MinePilot bot joins but does not move, interact, or attract hostile mobs. A joined player may be in Creative/Spectator, or its host simulation may be missing timely client input. Hostile mob targeting is not a definitive proof of player existence.

## Protocol research
- Current Bedrock movement is server-authoritative; the separate `set_movement_authority` packet was deprecated after protocol 818, and the pinned StartGame 1.26.60 schema does not include `movement_authority`.
- Before this PR MinePilot refused to send **any** PlayerAuthInput when that missing field stayed null. The app also sent only six input frames after manual button presses and no neutral input while idle.
- Authoritative movement requires an ongoing tick stream, even for a stationary player. `start_game.current_tick` seeds monotonically increasing `player_auth_input.tick` values.

## Implemented
- In the pinned 1.26.60 protocol, infer server-authoritative movement (mode 1), or rewind-style mode 2 if `rewind_history_size` is positive. Explicit authority overrides still win. Record source in diagnostics.
- On authenticated SDK spawn, complete the existing loading-screen packet sequence **before** launching the neutral presence writer.
- A continuous 20 Hz **no-direction** `player_auth_input` frame keeps the client participating in player ticks and uses only the server-observed player coordinates. No sprinting, mining, jumping, combat or teleportation is attempted.
- Neutral presence is enabled by default in the real Android friend-world session **even when experimental movement is disabled**. Physical diagnostic movement still requires manual opt-in and explicit confirmation.
- Neutral frames and bounded probes share one monotonic tick counter; no duplicate frame while a motion probe is running. Stop on session close, dimension change, missing world, authority changes and packet write failures.
- A standing still player often receives no self-position echo; a running neutral input stream permits a separate explicitly confirmed short movement probe even if last self position observation is older than 30 seconds. This does not imply actual verified movement.
- Android shows neutral heartbeat active/stopped, frame count, input error and whether movement authority was inferred.
- Updated and expanded deterministic same-client tests cover tick-stream continuity, packet serialization, simulated dimension changes, presence default and stop.

## Acceptance
CI and serializer tests can show correct packet encoding and Android packaging. Only a new real-device Xbox friend world test can verify whether the host now simulates MinePilot as an active player. No certainty of hostile mob aggro or real movement is claimed. Test in a flat safe area with Survival mode, movement diagnostic enabled, and check reported presence frames and corrections.

## Sources
- Mojang Bedrock protocol 1.26.60 PlayerAuthInput and StartGame docs: https://mojang.github.io/bedrock-protocol-docs/1.26.60/packets/player-auth-input-packet/
- Bedrock movement protocol deprecation: https://mojang.github.io/bedrock-protocol-docs/guides/movement-protocol-deprecation/
- Pinned PrismarineJS Minecraft Data: https://github.com/PrismarineJS/minecraft-data/blob/master/data/bedrock/latest/proto.yml

The resulting PR is deliberately draft until in-world test; automated successes do not count as live movement.