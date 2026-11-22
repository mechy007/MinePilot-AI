# MinePilot-AI

**Standalone Android Minecraft Bedrock bot — active development**

MinePilot-AI aims to run an independent Minecraft Bedrock player from an Android app, using a separate Microsoft/Xbox account to discover and join a friend's multiplayer world **without opening Minecraft or installing Termux on the phone**.

> **Project maturity: experimental.** The repository includes an Android shell, a packaged Node/Bedrock SDK diagnostic path, gameplay-planning foundations, and work-in-progress Xbox authentication. **A successfully built APK is not evidence of successful Xbox login, world join, spawn, or autonomous gameplay.** No end-to-end live Android friend-world join has been verified.

## Using a dedicated Xbox bot account on Android

In the runtime-enabled ARM64 debug build, open **Xbox → Sign in with Xbox Live** and choose the personal Microsoft account that should appear in Minecraft as the bot. Return to Xbox, enter the host’s gamertag or numeric XUID and tap **Join friend’s world** while the host has multiplayer open and allows that account to join. **Switch bot account** replaces the saved login after successful sign-in. **Forget bot account** clears the locally saved credential.

The build requires MinePilot’s authorized public-client application ID and registered redirect `minepilot://oauth`. The Android Node Runtime Probe workflow reads the repository Actions variable `MINEPILOT_XBOX_CLIENT_ID`. The local Gradle property is `minepilotXboxClientId`. An app registration and an Xbox player account serve different purposes.

This implementation supersedes the PR #59 status notes below for sign-in, credential storage, gamertag lookup and the Android runtime handoff. The app encrypts the refresh token using Android Keystore, obtains a fresh access token before joining and passes it through an app-private pipe. The runner checks the Xbox and Bedrock identities, resolves the host and attempts the existing NetherNet join. A successful live spawn still requires device and host verification.

## Project at a glance

| Property | Target / current scope |
| --- | --- |
| Platform | Android, ARM64 |
| Primary device | Vivo V2544, 8 GB RAM |
| Minecraft target | Bedrock 1.26.66.1 |
| Primary use case | Bot joins a consenting friend's hosted Bedrock world |
| Bot identity | Its **own** Microsoft/Xbox account, separate from the host |
| Phone requirements | No Termux or locally running Minecraft intended |
| Android app ID | `ai.minepilot.app` in current source |
| Development status | Experimental, not production-ready |
| Repository | [mechy007/MinePilot-AI](https://github.com/mechy007/MinePilot-AI) |

## What is implemented, experimental, and planned?

The status descriptions below distinguish repository code from verified device functionality.

| Area | Current state | Verification / limitation |
| --- | --- | --- |
| Android dashboard | Implemented; redesign in [PR #59](https://github.com/mechy007/MinePilot-AI/pull/59) | APK build and on-device UX are separate checks |
| ARM64 Node.js packaging | Implemented diagnostic build path | CI packaging/smoke tests; live device runtime needs validation |
| Bedrock SDK integration | Packaged experimental SDK and transport dependencies | Does not establish a successful friend-world join |
| Microsoft/Xbox login | Existing device-code diagnostic on older builds; browser-based OAuth + PKCE **in PR #59** | New flow requires an authorized app registration and real-account validation |
| Xbox Live / XSTS exchange | Experimental code in PR #59 | Not yet confirmed end-to-end on device |
| Friend identification | Numeric host XUID supported by diagnostic; gamertag field added in PR #59 | Gamertag-to-XUID lookup not implemented |
| Friend activity / world discovery | Experimental SDK join path | Real Xbox presence and permissions unverified |
| NetherNet / WebRTC transport | Bundled diagnostic dependencies | Real host interoperability unverified |
| Spawn and sustained connection | Instrumentation / test scaffolding | Requires host-observed live join, chunks and duration |
| Gameplay actions | Planning / engine foundations | Real-world follow, move, mine, build and inventory actions not validated |
| Autonomous tasks | Planned and partial foundations | No verified autonomous gameplay |
| Background bot service | Android service scaffolding | Sustained connection, notifications and recovery not validated |
| Production release | Not ready | Requires real-account, real-device and world tests |

### Intended end-user experience

1. Install MinePilot on Android.
2. Tap **Sign in with Xbox Live** and authenticate the bot's own Xbox account using Microsoft's official browser login.
3. Select or search for the friend hosting a joinable Bedrock world **by gamertag**.
4. Choose the world, connect the bot, and see clear connection stages and errors.
5. Keep the bot connected in the background and issue gameplay tasks.
6. Stop the bot, disconnect, switch accounts or sign out securely.

**This is the product goal, not a description of a currently working end-to-end flow.**

## Xbox Live sign-in: architecture and configuration

### Requested authentication UX

The intended user-facing login is **browser-based Xbox/Microsoft sign-in, not device-code entry**. PR #59 adds an Android `XboxSignInActivity` with an OAuth 2.0 authorization-code + PKCE flow and an Android deep-link callback, and removes the older device-code diagnostic activity from the debug manifest. Older code, guides and existing APKs can still contain the previous diagnostic flow.

Microsoft authentication uses the bot account's Microsoft credentials **on Microsoft's sign-in page**. MinePilot must not ask for or store the account password. OAuth and Xbox credentials must be handled as secrets.

### Experimental implementation in PR #59

| Item | Current code / configuration |
| --- | --- |
| Build property | `minepilotXboxClientId` |
| Authority | `https://login.microsoftonline.com/consumers` |
| Authorization type | Authorization code + PKCE (S256) |
| Requested scope | `XboxLive.signin offline_access` |
| Redirect URI in code | `minepilot://oauth` |
| Token exchange | Microsoft OAuth token → Xbox Live → XSTS |
| Client secret | Not used; a mobile public client must not embed one |
| Persistence | Not implemented |
| Bedrock engine handoff | Not implemented |

The client ID is configured at build time, for example:

```bash
cd android
gradle -PminepilotXboxClientId=YOUR_AUTHORIZED_CLIENT_ID :app:assembleDebug
```

This example is **configuration syntax**, not proof that the redirect URI or OAuth permissions are accepted. A valid Microsoft application registration, compatible redirect URI, allowed scopes, and real-device tests are still required. The app displays a configuration message if no client ID was supplied. **Do not commit secrets or account tokens.**

### Microsoft Entra / Azure registration issue

A personal Xbox account is not itself an OAuth application registration. Microsoft Entra administration access may require a tenant, and some Azure account signup flows ask for a debit or credit card. If you cannot register an application without a payment card, that is an **unresolved configuration blocker**, not a reason to bypass OAuth registration.

Investigate eligible tenant registration or an **authorized** existing integration. Do not copy unrelated applications' client IDs, evade Microsoft's account or API rules, or ask users to supply passwords to MinePilot. The desired sign-in experience remains browser-based; **no device-code fallback is planned for the new UI**.

### Security work remaining

- Verify authorization state and PKCE callback behavior, including cancellation and process recreation.
- Validate Xbox/XSTS responses and errors with a real account.
- Implement Android encrypted credential storage, token renewal, sign-out and account switching.
- Limit logging and prevent access/refresh tokens from appearing in logs or crash reports.
- Connect authenticated credentials to the embedded Bedrock client without exposing them to other apps.
- Test session expiry, revoked permissions, no network, and multiplayer eligibility.

## Friend discovery and joining

A **gamertag** is a human-readable Xbox account name. An **XUID** is the numeric Xbox account identifier. The current experimental join diagnostic identifies a specific world host using an XUID; the newer UI accepts gamertag text, but **does not yet resolve names to verified XUIDs**. A gamertag must never be passed to an API that requires a numeric XUID.

For an eventual join, the bot account must be permitted to play multiplayer and access the host's session. The friend must have the target Bedrock world open with multiplayer enabled. Discovery depends on Xbox activity/presence availability and any applicable platform or service permissions.

### Required live-join verification

A passing smoke test is not enough. The acceptance test must show:

1. The bot authenticates as the intended **separate** Xbox account.
2. The exact host is found, with no wrong-account selection.
3. A joinable friend-world session is discovered.
4. NetherNet/WebRTC negotiation and Bedrock login complete.
5. The host independently confirms the bot in the player list.
6. Spawn/start-game and subsequent world/chunk updates are received.
7. The bot remains connected for a sustained session, including background and screen-lock checks.
8. Disconnect, reconnect, account expiry and cleanup behave correctly.

The existing [friend-world integration guide](docs/friend-world-live-join.md) documents a development-workstation diagnostic; it is not evidence that Android joining is production-ready.

## Android app, UI and background operation

The project targets a standalone Android interface with account, friend/world, commands, tasks, settings and diagnostic views. The dashboard and premium launcher design are being developed in PR #59. The packaged runtime diagnostic executes in an isolated Android process.

Long-running operation requires lifecycle-safe foreground service behavior, a user-visible ongoing notification, explicit stop controls, network/battery handling, recovery after interruption, and secure session cleanup. These are acceptance requirements, **not verified features**.

### Target device considerations

- **Vivo V2544 / 8 GB RAM:** profile sustained memory use, CPU load, thermal behavior and battery impact.
- **ARM64:** use only compatible packaged runtime binaries and dependencies.
- **Android background limits:** test with the app minimized, screen locked and manufacturer battery restrictions applied.
- **Minecraft 1.26.66.1:** confirm protocol and transport interoperability on an actual friend-hosted world.

## AI and gameplay roadmap

| Phase | Status | What completion requires |
| --- | --- | --- |
| **0 — Authentication and connection** | In progress | Xbox login, exact friend discovery, successful live join, spawn, sustained session and secure account lifecycle |
| **1 — Gameplay controls** | In progress / foundations | Real-time world/player state, navigation, follow/stop, block interactions, inventory and reliable recovery |
| **2 — Autonomous planning** | In progress / foundations | Connect task planner to verified game actions, multi-step goals, persistent world memory and recovery |
| **3 — Advanced gameplay** | Not started | Test building, mining, survival, defense, farming, exploration and storage |
| **4 — Android experience** | In progress | World selection, account controls, task reporting, notifications, accessibility and emergency stop |
| **5 — Stability and optimization** | Not started | Long-duration Android tests, battery/memory profiling, reconnection and resource cleanup |
| **6 — Release and QA** | In progress | Green CI, verified device/world tests, security review and installable signed release |

Read the [detailed roadmap](docs/ROADMAP.md). Features such as automatic mining, building, combat, navigation, friend selection and AI decisions are **goals or partial foundations**, not promises about the current APK.

## Download and install an Android APK

1. Open the [GitHub Actions runs](https://github.com/mechy007/MinePilot-AI/actions).
2. Select a successful **Android Node Runtime Probe** workflow run.
3. Expand **Artifacts** and download `minepilot-android-arm64-friend-world-debug`.
4. Extract the ZIP and install the contained APK on a compatible ARM64 Android phone.
5. Record the workflow run, commit SHA and app behavior when reporting an issue.

The artifact is a **debug/test APK**, not a production release. GitHub may require sign-in to download artifacts. An older build may still show the device-code test; the newer OAuth UI in PR #59 requires its own successful build **and a configured authorized client ID**. Do not assume the latest successful build includes every unmerged change.

## Build and test locally

### Development prerequisites

- Node.js 24 for the engine and Bedrock SDK tooling.
- JDK 17, Android SDK 35, Gradle 8.9, Android NDK 28.0.13004108 and CMake 3.22.1 for the Android CI-compatible environment.
- ARM64 Android device for runtime verification.
- Separate bot and friend/host Xbox accounts for real multiplayer tests.

### Engine tests

```bash
npm install --ignore-scripts --omit=optional
npm test
```

### Android runtime test build

The [runtime packaging guide](docs/ANDROID-RUNTIME-PACKAGING.md) describes the staging scripts and required Android toolchain. After staging dependencies:

```bash
cd android
gradle -PminepilotNodeSmoke=true :app:assembleDebug :app:testDebugUnitTest
```

The Android runtime pipeline stages Node.js Mobile, the Bedrock SDK, and the JavaScript WebRTC transport. Dependencies documented in the packaging guide include `bedrock-protocol` **3.61.0**, `minecraft-data` **3.119.0**, and the 1.26.60 codec used for protocol 2225. Exact interoperability with the target 1.26.66.1 world still requires a live test.

### CI and build artifacts

- [All GitHub Actions workflows](https://github.com/mechy007/MinePilot-AI/actions)
- [Android Node Runtime Probe](https://github.com/mechy007/MinePilot-AI/actions/workflows/android-node-smoke.yml)
- [Open pull requests](https://github.com/mechy007/MinePilot-AI/pulls)

CI checks can validate builds, packaging, code and synthetic SDK behavior. **They cannot replace a real Xbox login and host-observed Minecraft join test.**

## Architecture overview

```text
Android dashboard / account UI
           |
           +--> Browser OAuth + PKCE (experimental PR #59)
           |         |
           |         +--> Microsoft OAuth --> Xbox Live --> XSTS
           |
           +--> Android service / lifecycle (partial)
                       |
                       +--> Embedded ARM64 Node runtime (diagnostic)
                                   |
                                   +--> Bedrock SDK / Xbox friend activity
                                   +--> NetherNet / Werift WebRTC
                                   +--> Bedrock protocol state
                                   |
                                   +--> Gameplay engine and task planner
```

The diagram describes the **intended integration boundaries**, not a fully connected production pipeline. In particular, the new OAuth sign-in is **not yet wired into** the Bedrock runtime.

## Troubleshooting

| Symptom | Meaning / next action |
| --- | --- |
| “OAuth is not configured” | No authorized `minepilotXboxClientId` was supplied at build time |
| Microsoft redirect rejected | App registration and redirect URI are not compatible; validate the registered mobile redirect |
| Azure / Entra signup requests a card | Application registration access remains unresolved; don't bypass identity requirements |
| Gamertag cannot join | Gamertag-to-XUID lookup is not implemented; diagnostic joining still requires a numeric XUID |
| Friend/world not found | Check host online status, multiplayer settings, bot account permissions, and Xbox presence visibility |
| SDK smoke tests pass but bot does not join | Packaging tests do not establish live transport interoperability |
| App disconnects when backgrounded | Background session lifecycle and battery/notification behavior still require implementation and testing |
| Old APK displays device code | It was built from an older commit; verify the workflow SHA before installing |

For deeper diagnostics see [Android app test guide](docs/ANDROID-APP-STATUS.md) and [desktop integration guide](docs/friend-world-live-join.md). Some linked documents describe the **older device-code diagnostic**; this README distinguishes that legacy test from the new browser-login direction.

## Security, privacy and responsible testing

- Sign in only through Microsoft's official authentication page.
- Never send Microsoft passwords, access tokens, refresh tokens or device codes to maintainers or issue trackers.
- Never hardcode OAuth client secrets into a mobile APK.
- Test only with Xbox accounts and friend-hosted worlds you are authorized to access.
- Do not interpret a mock identity, CI pass or client-side “connected” message as proof that a host accepted the bot.
- Treat debug artifacts as experimental and avoid using valuable accounts until account/session handling is validated.

## Known blockers and next engineering priorities

1. **OAuth registration and redirect compatibility:** obtain an authorized client ID without requiring users to share secrets or register their own app.
2. **Authenticated runtime handoff:** implement a secure Xbox credential bridge to the Bedrock SDK and protected token lifecycle.
3. **Friend lookup:** implement verified gamertag-to-XUID resolution using permitted APIs.
4. **Live interoperability:** test friend activity, NetherNet connection, Bedrock login, spawn and world packet processing.
5. **Android reliability:** foreground service, notification, cancellation, reconnect, and memory/battery testing.
6. **Gameplay and AI:** connect world state and verified actions to the planner, then test increasingly complex tasks.
7. **Release readiness:** security, regression tests, CI, device verification, signed APK and installation instructions.

## Documentation

- [Android app status / friend-world test](docs/ANDROID-APP-STATUS.md)
- [Development roadmap](docs/ROADMAP.md)
- [Android ARM64 runtime packaging](docs/ANDROID-RUNTIME-PACKAGING.md)
- [Desktop friend-world diagnostic](docs/friend-world-live-join.md)
- [Gameplay planning integration](docs/CRAFTMIND_GAMEPLAY_INTEGRATION.md)

## Contributions and issue reports

When reporting a problem, include the Android device/model, OS version, Minecraft version, APK workflow run and commit SHA, reproduction steps, and **sanitized** diagnostic output. Do not post Xbox credentials, tokens, authorization codes, personal identifiers or screenshots exposing account secrets.

---

**Bottom line:** MinePilot's immediate milestone is **real Xbox sign-in → friend discovery → host-confirmed Bedrock join**. Gameplay automation comes after that connection is genuinely verified.
