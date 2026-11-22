# Android account sign-in and friend-world test

The runtime-enabled ARM64 debug APK opens MinePilot’s dashboard. The Xbox tab provides Microsoft sign-in, account switching, a friend gamertag or XUID field, and a join action. On a new account, MinePilot opens the Microsoft approval page with the code filled in, displays the code, and polls for approval. When a user starts a join before signing in, the same flow continues into world discovery and connection after Microsoft approval.

## Install and try the connection

1. Download the minepilot-android-arm64-friend-world-debug artifact from a successful [Android Node Runtime Probe run](https://github.com/mechy007/MinePilot-AI/actions/workflows/android-node-smoke.yml), extract the APK, and install it on the Vivo V2544.
2. Open **MinePilot → Xbox**. Sign in with a separate Microsoft/Xbox account for the bot, or enter your friend’s gamertag/XUID and tap **Join friend’s world** to combine sign-in and joining.
3. Approve MinePilot on Microsoft’s page. Leave MinePilot open while authentication and the join attempt continue.
4. Have the host open a Bedrock world with multiplayer enabled and permit the bot account to join.
5. If the app reports **Bedrock spawn received**, ask the host to confirm the bot appears in the player list. Keep the session open for at least 10 minutes on the Vivo V2544, with the host using another device. Record duration, received chunk count and disconnect behavior, including when MinePilot is backgrounded or the phone is locked.
6. Tap **Stop connection** and confirm the player leaves the host’s player list. Report the status and workflow commit without sharing codes, passwords or tokens.

## What has been tested

The engine suite runs on Node. Packaged SDK checks use synthetic account and packet data to verify identity matching, owner selection, the start-game/spawn gate, elapsed-time reporting and cancellation. These checks do not prove Microsoft sign-in, Xbox friend activity, transport interoperability, host confirmation or Android background reliability. Live Android results remain pending.

Friend discovery requires Xbox to expose the host’s joinable activity to the signed-in account. Presence, multiplayer permissions and title-service behavior affect visibility. The current build attempts one connection and reports its failing stage. A production background service, automatic reconnection and invitation support remain future work.

## Identity and dependencies

MinePilot holds the authenticated Xbox session in the isolated Android runtime. It encrypts the refresh token and gamertag with Android Keystore-backed storage. Runtime status reports contain the login stage and account identity. A private pipe carries the refreshed token directly to Android Keystore-backed encryption without writing it to a status file. The app suppresses screenshots while displaying a sign-in code, auto-opens only an allowlisted Microsoft HTTPS page, and offers a code-copy option. Ending the activity clears the authentication status. The next launch sweeps temporary runtime files.

The build packages bedrock-protocol 3.61.0, Prismarine authentication and Xbox services, and the pure JavaScript Werift WebRTC backend. It uses the 1.26.60 codec for protocol 2225, which Mojang also lists for [Bedrock 1.26.66](https://mojang.github.io/bedrock-protocol-docs/changelog/#12666). Interoperability with the exact 1.26.66.1 device build requires the live test. See [ARM64 runtime packaging](ANDROID-RUNTIME-PACKAGING.md) for license notices and the runtime build.
