# Friend-world live join: implementation and verification

The Android APK currently has a **diagnostic-only** `BedrockEngine.Unavailable` and cannot join a Minecraft world. The Node.js runner in `src/connection/friend-world-join-runner.ts` is an integration boundary, **not proof of interoperability**.

## Node-side smoke test (development workstation only)

1. Install a supported Node.js runtime (the upstream `bedrock-protocol` 3.61.0 manifest specifies Node.js >=24).
2. Install project dependencies and a compatible `bedrock-protocol` package. Its transitive native RakNet/NetherNet dependencies may need platform-specific builds. Do not assume they work on Android.
3. Set `MINEPILOT_XBOX_USERNAME` to the Xbox account used by the bot, and `MINEPILOT_FRIEND_XUID` to the **friend hosting the world** (numeric XUID). These are distinct identities.
4. Run `npm run friend:join` and complete the official Microsoft device-code flow if prompted. Never share account passwords, tokens or device codes with anyone.
5. Confirm that the friend has multiplayer enabled, the account is permitted to join, and the friend is online. A `spawned` event means the SDK emitted spawn; **the friend must independently verify the player appears in the world**.
6. Stop with Ctrl+C. Test reconnect, expired credentials, owner offline, and interrupted connectivity.

## Android blockers

- Integrate a supported on-device Microsoft/Xbox authentication implementation with protected token storage.
- Embed an actual compatible Bedrock transport, including friend-session discovery, NetherNet/RakNet and protocol decoding; the current Java UDP classes are primitives, not a Bedrock client.
- Connect that runtime to `BedrockEngine` and the dashboard with lifecycle-safe background execution and foreground-service notifications.
- Test on the target Android device and Minecraft Bedrock version against a consenting friend-hosted world.

The Android app must continue to fail closed until these are implemented and verified. Mocked unit tests and a successful APK build are not live-join evidence.
