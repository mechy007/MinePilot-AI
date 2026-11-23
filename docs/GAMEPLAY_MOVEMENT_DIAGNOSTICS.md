# Gameplay Execution — Movement Diagnostics and Synchronization

This PR changes the actual Bedrock player input writer. It is still an EXPERIMENTAL transport milestone, not proven walking or following.

## Implemented
- Reuses the single authenticated Xbox/NetherNet friend-world connection and Bedrock 1.26.60 protocol player-auth-input serializer.
- Bounded 20 Hz diagnostic frame sequences: forward, turn left, turn right. Strict 1–20 frames plus one neutral stop frame.
- Retains the earlier six-frame probe_step command and its existing tests.
- Requires manual Android experimental toggle and confirmed command, valid spawn/entity, movement authority, server tick, chunks and recent position.
- Two-stage Android confirmation, no automatic repeat, no unbounded background locomotion.
- Separately tracks sent input frames, observed self-position updates, corrections, drift, displacement and last stop reason.
- Stops on user cancellation, completion, session failure or repeated major prediction divergence; makes no new Minecraft connection.
- Sanitized telemetry never stores raw account tokens or world packet buffers.
- Deterministic unit/fixture tests and actual pinned SDK serializer validation.

## Critical acceptance blockers
1. Numeric input flag, yaw and movement authority are not yet confirmed on a real Xbox friend-hosted Minecraft world.
2. A position delta can be caused by gravity, knockback or server correction. movementVerified remains false.
3. No verified collision map, jump, sprint, swimming, automatic follow, mining or crafting executor exists.
4. True 20 Hz continuous physics, tick reconciliation, on-ground inputs and route execution should only be implemented after host verification.
5. Keep stacked PR draft; do not merge into stable or request a new APK install for this engineering step.

This is a bounded movement diagnostic, not autonomous gameplay.