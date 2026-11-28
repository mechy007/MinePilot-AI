# MinePilot Project Integration Map

This document describes the live Android friend-world runtime and the boundaries between production code, planning modules, and test tooling.

## One-session rule

The Android friend-world session owns one Xbox-authenticated Bedrock client. Every gameplay subsystem receives that same client or observes its packets through the same `BedrockGameplayBridge`. Do not add a second Bedrock connection, competing movement writer, or separate physics authority.

## Live connection and control path

```text
Android UI
  -> WorldSessionProvider
  -> manual-input-state.json
  -> android-friend-world-session.cjs
  -> android-friend-world-join.cjs (MPSD handle + RTA + nonce + peer route)
  -> one Xbox/NetherNet Bedrock client
  -> BedrockGameplayBridge
  -> BedrockMovementController
  -> Bedboo-derived physics + BedrockTerrainCache + collision registry
  -> Bedrock input queue
  -> client.queue('player_auth_input')
  -> Bedrock server position/correction packets
  -> movement reconciliation + Android diagnostics
```

Manual input is a short-lived mailbox, not proof of movement. The UI writes a new request ID and expiry; the bridge validates it, applies controls to the movement controller, and the tick queue emits input frames. A queued frame is not a server acknowledgement. Server position changes and correction packets remain the evidence used for reconciliation.

## Terrain and movement readiness

The movement controller publishes unknown collision cells in its `terrain.unknownCells` snapshot. `BedrockTerrainCheck` consumes those exact cells and asks the existing bridge to request only the missing subchunk sections. It does not guess unknown blocks or repair collision-registry mismatches by downloading more chunks.

The control loop also retries movement-presence startup when required session metadata was not available at the first spawn event. Startup retries are bounded by a 500 ms interval and stop when the queue is active, the session closes, or movement authority is unsupported.

## Connected subsystems

| Subsystem | Live integration |
|---|---|
| Xbox identity and friend-world discovery | `android-friend-world-session.cjs` authenticates; `android-friend-world-join.cjs` selects the exact activity handle, joins MPSD with the live RTA ConnectionId, applies the host nonce and selects the PmsgId/legacy peer route. The resulting membership and RTA subscription are owned by the one Bedrock client. |
| TypeScript gameplay layers 1–8 | Built from `src/gameplay`, staged into the same Node session bundle, and injected into the bridge as planners, supervisors, or readiness policy. |
| Bedrock terrain and physics | `BedrockTerrainCache`, the vendored Bedboo-derived physics library, collision data, movement controller, and input queue share one world/dimension. |
| Inventory and item actions | Inventory packets feed the authoritative ledger; stack requests are serialized through the same Bedrock client and await server responses. |
| Crafting | The recipe catalogue observes Bedrock `crafting_data` and item registry packets; crafting remains gated by exact recipe and inventory evidence. |
| Life and intelligence | Server vitals, entities, position, and dimension feed life-senses and intelligence; safety signals can stop active goals. |
| Navigation and autonomy | Local A* and verified movement are used only with observed terrain. Plans and metadata do not automatically become executable actions. |
| Autonomous player follow | `follow_player` selects a server-observed player and delegates to `VerifiedAutonomyRunner`; follow remains active while the target is within 3 blocks or temporarily stale, replans when fresh target observations move, and stops on safety/session/dimension failure. Explicit manual input preempts and cancels follow. |
| Runtime extensions | Packet observation, world knowledge, decision recording, capability assessment, stuck detection, and read-only plugin registry are attached to the bridge. |
| Android diagnostics | Queue state, queued frame count, last input flags, capability evidence, and stuck assessments are surfaced to the Manual controls screen. |

## Deliberate execution boundaries

- The task execution coordinator remains non-executable unless a validated adapter is explicitly provided.
- Stuck detection is advisory; it does not issue recovery movement.
- ODYSSEY and other imported skill libraries are metadata/planning inputs unless a matching Bedrock-native executor is explicitly implemented and tested.
- Read-only plugin and observation modules cannot send gameplay packets.
- Unsupported, unknown, stale, or custom terrain remains blocked rather than being guessed.

## Source and test boundaries

- `scripts/android-friend-world-session.cjs`, `scripts/android-friend-world-join.cjs`, and `scripts/bedrock-gameplay-bridge.cjs` are the embedded Android gameplay path.
- `src/` contains TypeScript gameplay/connection modules that are built and staged into that same session bundle; it is not a second live client.
- `vendor/bedboo-physics` is the pinned CommonJS physics implementation used by the Bedrock movement controller.
- `npm test` builds TypeScript, runs the complete root script test set serially, then runs runtime-extension tests.
- The Android Node Runtime Probe stages the exact SDK bundle and runs its staged contract suite. The Android Shell APK and Bedrock SDK workflows validate packaging and protocol compatibility.

## What CI does not prove

CI can verify module wiring, packet serialization, queue behavior, staged runtime imports, and APK packaging. It cannot prove that an Xbox-hosted friend world accepts movement. Bedrock 1.26.66.1 and real-world movement still require a live session test with the target server.
