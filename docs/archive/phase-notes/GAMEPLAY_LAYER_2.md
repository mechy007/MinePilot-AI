# MinePilot Gameplay — Layer 2 (following plan, tracking and home return)

Status: implemented on the Layer 2 integration branch as **planning and observation only**. Not live autonomous following.

Base: feature/gameplay-layer-1-observe-command / PR #90. Layer 2 is stacked on PR #90; underlying PR #89 is still a draft until in-world movement verification.

## B: navigation and player tracking

- Track visible players received from Bedrock `player_list`, `add_player`, `move_player`, and `remove_actor`. Use a bounded 64-player cache, validate names and runtime IDs, and expire positions after eight seconds.
- Follow requires a user-entered **exact observed gamertag**. It does not implicitly select the nearest stranger.
- Compute horizontal heading, estimated distance and a single bounded next waypoint. A three-block follow distance stops route planning when the player is close.
- If a player disappears, the world changes dimension, the position is too old, or health becomes critical, the follow plan becomes waiting/paused.
- Without decoded voxel collision data, the output remains `route_unverified`. **The plan intentionally never queues a movement packet.** The existing, opt-in movement probe is separate and rejected while Follow or Return is planned.

## C: gameplay observation

- Observe only the authenticated bot entity's `mob_equipment` changes. Retain selected slot and numeric item network ID, but do not equip items, interact with inventories or invent tool names.
- Include a redacted list of up to eight observed player names for UI guidance. No raw identity chain, XUID, network transport data, or arbitrary remote chat is displayed.
- Read nearby player positions from live packets, but do not claim line of sight, physical collision, or a navigable path without the chunk block decoder.

## D: companion task planning

- **Plan follow player:** enters a named target goal, requiring a fresh matching actor; no automatic movement.
- **Stay here:** stops the experimental movement and sets the Layer 1 manual hold.
- **Mark home:** records the current observed player position and dimension for the present session.
- **Plan return home:** computes a direct heading and waypoint towards home; does not move.
- **Stop movement:** cancels outstanding plans and current input. Session close and dimension switch invalidate the goals and cached home coordinates.
- New accepted Follow/Return plans release the previous Stay hold, but still never emit movement packets.

## Tests

- Unit tests: exact target matching, missing/ambiguous names, stale positions, close distance, vertical path rejection, different dimension, home return, equipment bounds and manual cancel.
- Packaged runtime integration: same-client tracking, planning, Stay/Return, stop and health override, and confirmation no player-auth-input packet was sent by navigation planning.
- Continue all existing Xbox login, Bedrock SDK, Android Shell, Android Node Runtime and Engine CI checks.

## Following implementation gate

No walk/follow activation until the physical-host test confirms correctly serialized `player_auth_input` frames, acceptable server corrections and collision-safe navigation. The unverified forward probe from PR #89 is not a safe replacement for real 20 Hz movement physics.

Release strategy: no per-layer user APK installation. Keep features in stacked draft PRs; deliver a consolidated Android beta after the engine is materially usable and physical-device verification can be performed meaningfully.
