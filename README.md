# MinePilot-AI

MinePilot-AI is an **experimental standalone Android Minecraft Bedrock bot** targeting the Vivo V2544 (ARM64, 8 GB RAM) and Minecraft Bedrock **1.26.66.1**. The goal is for a bot using its own Microsoft/Xbox account to discover and join a friend's Bedrock world without Minecraft or Termux running on the phone.

> **Status:** Work in progress. CI smoke tests and successful APK builds do **not** prove that Xbox authentication or a live friend-world join works end to end.

## Current Android app (development branch)

- Redesigned MinePilot dashboard and launcher icon, with diagnostic tools and an ARM64 runtime test build.
- An experimental **Sign in with Xbox Live** button opens Microsoft's browser-based OAuth authorization-code flow using **PKCE**. The Android app receives an OAuth redirect and attempts Xbox Live / XSTS token exchange.
- The device-code authentication **screen has been removed from the development branch’s Android debug manifest**. Some older diagnostic source and documentation may still refer to device-code sign-in; it is not the intended user-facing login.
- Friend-account entry accepts a gamertag or numeric XUID in the interface, but **gamertag-to-XUID lookup is not implemented**. Joining tests still require a numeric XUID.
- Xbox session persistence, secure token storage, Bedrock runtime handoff, friend-world discovery and live joining **remain incomplete or unverified**.

## Xbox Live sign-in configuration

The experimental browser sign-in feature in [PR #59](https://github.com/mechy007/MinePilot-AI/pull/59) requires an **authorized Microsoft application registration** with a public-client application ID and compatible redirect configuration. An Xbox/Microsoft personal account alone is **not** an application registration.

The current Android code expects:

| Setting | Current implementation |
| --- | --- |
| OAuth client ID | Gradle property `minepilotXboxClientId` |
| Authorization authority | `https://login.microsoftonline.com/consumers` |
| OAuth flow | Authorization code + PKCE |
| Requested scopes | `XboxLive.signin offline_access` |
| Android callback | `minepilot://oauth` |
| Client secret | **Not required; do not create or commit one** |

For example, pass the client ID to Gradle as `-PminepilotXboxClientId=YOUR_REGISTERED_CLIENT_ID`. The registration must permit the selected redirect URI; **verify that Microsoft accepts the URI before relying on this implementation**. A missing client ID causes the sign-in screen to show a configuration message. No working account sign-in has yet been demonstrated.

**No payment card?** Azure free-subscription registration may request a debit/credit card, and a personal Xbox account may not be allowed to access the Entra administration portal. Do not assume Azure signup is required or that a card-free tenant is available to every account. Investigate an eligible free tenant or an authorized integration; do not bypass OAuth registration, reuse unauthorized client IDs, or collect Xbox passwords inside MinePilot.

## Get the latest debug APK

1. Open [GitHub Actions](https://github.com/mechy007/MinePilot-AI/actions).
2. Select the latest successful **Android Node Runtime Probe** run.
3. Download the `minepilot-android-arm64-friend-world-debug` artifact.
4. Extract the ZIP and install the APK on a compatible ARM64 Android device.

**Note:** The main branch and development PR can produce different APKs. Check the workflow commit SHA: older builds may still use the device-code diagnostic, while the newer browser sign-in requires a configured OAuth client ID. A successful build may contain experimental or unconfigured sign-in features. Check the commit and workflow run before assuming a particular feature is included.

## Development and documentation

Use Node.js 24, then run `npm install --ignore-scripts --omit=optional` and `npm test`. The Android Node Runtime Probe workflow stages the ARM64 runtime and Bedrock SDK, executes bundled checks, and uploads the debug APK.

- [Android app status and testing](docs/ANDROID-APP-STATUS.md)
- [Project roadmap](docs/ROADMAP.md)
- [Android runtime packaging](docs/ANDROID-RUNTIME-PACKAGING.md)
- [Existing desktop friend-world diagnostic](docs/friend-world-live-join.md)

## Next priorities

1. Validate the Microsoft application registration, redirect, and OAuth/Xbox token exchange on a real Android device.
2. Connect authenticated credentials to the Bedrock runtime securely; implement protected session storage and logout.
3. Resolve Xbox gamertags to verified XUIDs, where supported by authorized APIs.
4. Validate friend discovery, live join, spawn, reconnection, and long-running background operation.
