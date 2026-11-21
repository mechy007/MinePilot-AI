# Android friend-world test

The ARM64 debug APK has two diagnostic launcher entries. **MinePilot Node Runtime Test** checks Node, cryptography, UDP, the Bedrock codec, and WebRTC offer creation. **MinePilot Friend World Test** signs in using the Microsoft device-code flow. With an owner Xbox ID, it uses the Bedrock SDK to query Xbox friend activity, select the exact world owner, and attempt to join over NetherNet/WebRTC. The standard Android dashboard and diagnostic service ship separately from this experimental entry point.

## Install and try the connection

1. Download the `minepilot-android-arm64-friend-world-debug` artifact from a successful [Android Node Runtime Probe run](https://github.com/mechy007/MinePilot-AI/actions/workflows/android-node-smoke.yml), extract the APK, and install it on the Vivo V2544.
2. Open **MinePilot Node Runtime Test** and record the result. Then open **MinePilot Friend World Test**.
3. Have your friend open the Bedrock 1.26.66.1 world with multiplayer enabled and make it joinable by the bot account. Enter the world owner’s numeric Xbox user ID (XUID). Leave the field blank to check sign-in without joining.
4. Tap **Start sign-in or join friend’s world**. Use **Open Microsoft** and enter the code on Microsoft’s website. Sign in with the bot account that has permission to play with the host. Return to MinePilot.
5. After the app displays **Bedrock spawn received**, have the host confirm the bot appears in the player list and check that the level-chunk packet count increases. Keep the session open for at least 10 minutes with the host on another device. Record the duration, chunk count and any disconnect, including after backgrounding MinePilot or locking the phone.
6. Tap **End test**. Let the Xbox/NetherNet session close and confirm the player leaves. Reopen the launcher for a fresh attempt. Report the stage and app status without sharing a device code or credentials.

## What has been tested

The engine suite runs on Node. The packaged SDK tests use synthetic account and packet data to verify identity matching, owner selection, the start-game/spawn gate, elapsed time reporting, and cancellation. The SDK smoke tests run against the packaged codec and WebRTC dependencies. Successful packaging, Microsoft sign-in, Xbox friend activity, transport interoperability, host confirmation, and Android background behavior are separate checks. Live Android results remain pending.

Friend discovery requires Xbox to expose the host's joinable activity to the signed-in account. Presence, permissions, and title service behavior can affect visibility. The current build takes one owner XUID, tries one connection, and reports the failing stage. Foreground-service integration, reconnection, invitations, and a production dashboard remain future work.

## Identity and dependencies

The test uses the same in-memory Xbox auth object for device sign-in, profile lookup, and Bedrock join. The isolated process holds tokens in memory. Private app files carry the requested XUID, transient device-code instructions, and connection state. The UI suppresses screenshots and opens only allowlisted Microsoft HTTPS device-code URLs. Ending the test clears transient state, and the next run removes any stale files left after a forced process exit. External account access and friend discovery are subject to Microsoft/Xbox service permissions.

The build packages `bedrock-protocol` 3.61.0, Prismarine authentication and Xbox services, and the pure JavaScript Werift WebRTC backend. It uses the 1.26.60 codec for protocol 2225, which Mojang also lists for [Bedrock 1.26.66](https://mojang.github.io/bedrock-protocol-docs/changelog/#12666). Interoperability with the exact 1.26.66.1 device build requires the live test. See [ARM64 runtime packaging](ANDROID-RUNTIME-PACKAGING.md) for license notices and the runtime build.
