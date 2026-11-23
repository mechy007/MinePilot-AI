# Live Gameplay Probe — Android friend-world build

## What exists

The same Android Node process that performs Xbox authentication, world selection, NetherNet joining and Bedrock spawning can now attach a read-only gameplay observer and accept bounded private commands from the Command Center. There is **no second Minecraft client**.

The observer reads StartGame (runtime id, position, dimension, server movement mode/tick), level_chunk headers, add_player/move_player/remove_actor, server position corrections, and reports only bounded, sanitized counts and coordinates. Headers are **not** decoded voxel data, so obstacles, hazards and walking-safe terrain are still unknown.

The bedrock-player-input.cjs module constructs a 1.26.60 / protocol 2225 PlayerAuthInput packet and includes a *six-tick* diagnostic pulse. It is disabled by default, must be enabled separately **before joining**, and each probe requires its own warning confirmation. The packet codec can serialize the shape in the packaged SDK's smoke tests, but neither that test nor a successful queue call proves the host accepted the movement.

As of 2026-11-23 Minecraft Bedrock 1.26.66 uses protocol 2225, with no packet changes since 1.26.60 according to Mojang's public changelog. This reduces schema risk but does not establish gameplay correctness, physics or Xbox friend-world compatibility.

## Device verification procedure

1. Install the successful **Android Node Runtime Probe** debug APK artifact from the exact PR commit being tested. The artifact is called minepilot-android-arm64-friend-world-debug in the workflow. Do not confuse it with the lightweight Android Shell build or APK from a previous commit.
2. Use an independent bot Xbox account. Have a trusted friend host a private, flat, safe Bedrock world, away from cliffs, lava, water, other players, expensive structures and valuable inventory.
3. In the MinePilot World dashboard choose **Enable experimental movement for next join**, read the warning, and confirm. This setting does not enable autonomous actions; it only enables an expressly commanded, bounded probe in the next connection.
4. Join your friend's world using the existing Xbox flow. Wait until the host sees the bot. Open Command Center and record its world position, nearby-player count, movement capability and correction count. If position/chunks are absent or movement is unavailable, **do not bypass the gate**; capture diagnostic stage and stop.
5. While the observed server position is fresh, tap **Experimental: move forward briefly** and confirm. The runtime may queue up to six player_auth_input movement frames and one neutral stop frame. Check the last-command receipt. Accepted means *queued for experimental transmission*; it does NOT mean moved.
6. Ask the host to independently confirm whether the bot physically moved and by how much, whether there was rubber-banding, unexpected jumping, kicks or a disconnect. Record before/after **server-observed** coordinates if available. If any unexpected behavior occurs, tap **Stop movement** and then **Disconnect bot**.
7. With experimental mode disabled, verify that all movement probes are rejected while the bot still logs in, spawns and stays connected normally.
8. Reconnect, disconnect, and check that the old session cannot control a new one. Verify the bot disappears from the host world after explicit disconnect.

## Failure modes to investigate next

- No displayed position: StartGame may not provide the expected player_position; inspect packet structure safely via local redacted tests, not live credentials.
- Movement remains unavailable: the negotiated authority may be client-side, StartGame tick missing, position stale, chunk header missing, or client lacks queue.
- Packet queued but no movement: physical input/physics simulation, tick sequence, yaw, flags and server-authoritative corrections may be wrong. Don't fix by teleporting or sending deprecated client-bound move_player packets.
- Invalid packet/kick: rerun pinned codec fixture and inspect safe numeric disconnect diagnostics; do not log auth chains, nonce, XUID, private messages or whole raw packet payloads.
- World position differs from predicted position: use server correction as truth, reset prediction and stop on repeated mismatch; **never** report a successful walk from the sent packet count.
- Background session dies: test OS foreground service rules, notification, Doze, screen-off and network handoff separately; a CI APK build is not a physical-device test.

## Further development gates

- Verify one bounded movement probe on physical hardware.
- Add authoritative tick clock, neutral input heartbeat and real Bedrock movement physics, collisions and correction reconciliation.
- Decode chunk block palette/subchunk contents; never assume unread terrain is empty.
- Implement a waypoint walker with stop, terrain confidence, stuck detector and bounded corrections.
- Implement follow-player identity mapping with user-selected trusted player and movement arbitration from src/gameplay/navigation-authority.ts.
- Only then implement server-verified mining, block placement, inventory, crafting, building, survival and Qwen task planning.

References:
- https://mojang.github.io/bedrock-protocol-docs/changelog/
- https://mojang.github.io/bedrock-protocol-docs/1.26.60/packets/player-auth-input-packet/
- https://mojang.github.io/bedrock-protocol-docs/guides/player-movement-overview/
