# Movement reliability and validation

Last updated: 2026-11-26

## What changed

The movement pipeline now treats Bedrock server corrections correctly. In server-authoritative movement, a positive acknowledgement is not guaranteed for every accepted `PlayerAuthInput` frame. The server sends a correction when its authoritative simulation disagrees with the client prediction. Therefore:

- Manual control no longer stops after seven seconds merely because no correction packet arrived.
- The controller keeps collision-checked prediction active while the user holds the joystick.
- Rotation-only `MovePlayer` packets update facing but do not rewrite player position or clear pending movement prediction.
- A real server position change or correction reconciles the predicted state.
- Bounded autonomy accepts a server-observed progress update when one arrives. Without a correction, it may continue from local predicted position only after a 1.2-second correction grace period and only when physics reports at least 0.08 blocks of progress. If neither server position nor local prediction progresses, it stops.
- Autonomy reports server-verified progress and prediction-only progress separately. Prediction-only must never be described as server-confirmed.
- Terrain preflight samples around the current simulated player position, not the stale spawn position.
- Missing block observations trigger bounded subchunk retry requests around the predicted player position. Requests are throttled per chunk column; registry/collision mapping errors are reported separately and are not blindly retried.
- The Android screen shows the last runtime receipt, execution stage, and first missing collision cell. A command being written to the inbox is reported as queued, not executed.

## Local automated coverage

The test suite now includes coverage for:

1. Sustained manual movement beyond the previous seven-second cutoff without a positive correction packet.
2. Terrain preflight following predicted position after movement.
3. Recovery when previously missing terrain arrives.
4. Rotation-only, normal-position, and teleport/reset `MovePlayer` packet handling.
5. Android-style command inbox dispatch through the gameplay bridge, including execution receipts and manual release.
6. Missing-subchunk retry around predicted chunk coordinates with a five-second per-column cooldown.
7. Bounded autonomy continuing only when local physics predicts progress in the absence of a server correction, and stopping when neither source reports progress.

## Required Android acceptance test

These checks still require the actual Android device and a friend-hosted Bedrock 1.26.66.1 world. CI cannot prove real server movement or OEM background behavior.

1. Install the latest successful ARM64 debug APK and sign in with the separate Xbox account.
2. Join a friend-hosted world and wait until the control screen reports movement ready and terrain preflight is clear.
3. Test forward, backward, strafe, diagonal, jump, sprint, sneak, and explicit stop.
4. Hold forward or strafe for at least 15 seconds. Movement must not stop solely because no correction packet was sent.
5. Release the joystick. Input must return to neutral promptly.
6. Move across a chunk boundary. Confirm subchunk requests increase only while block observations are missing, and the missing-cell diagnostic clears after terrain arrives.
7. Walk into a solid wall. The server correction, if emitted, must reconcile the local prediction without leaving the controller stuck or continuing through the wall.
8. Run one bounded autonomy step. The UI must distinguish server-confirmed steps from prediction-only steps. If both server position and local physics show no progress, the runner must stop.
9. Keep a world session active while the app is backgrounded and the screen is off. Confirm the foreground service remains visible and the session reconnects after an Android process recreation where the OS allows sticky service restart.

Record the APK version, Android version, world host version, whether each check passed, and the displayed movement reason when a check fails.

## Foreground-service note

The debug friend-world service uses the Android `specialUse` foreground-service type because it maintains a user-started, persistent game-world session rather than performing a finite data-sync task. The manifest includes a specific subtype explanation. If the app is later distributed through Google Play, the special-use case must be declared and reviewed under Play's foreground-service policy.

## Important limits

- `movement_controls_applied` means the local controller accepted the input. It is not proof that the server moved the player.
- `correction_only_if_prediction_differs` describes the protocol behavior; it is not a positive acknowledgement.
- Prediction-only autonomy progress is not server-verified progress.
- No live Android device test has been recorded by CI. Do not mark joystick movement or background recovery fully verified until the acceptance test above has been run on-device.
