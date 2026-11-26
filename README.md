# MinePilot-AI

**Standalone Android Minecraft Bedrock bot — active development**

MinePilot-AI aims to run an independent Minecraft Bedrock player from an Android app, using a separate Microsoft/Xbox account to discover and join a friend's multiplayer world **without opening Minecraft or installing Termux on the phone**.

> **Project maturity: experimental.** The repository includes an Android shell, a packaged Node/Bedrock SDK diagnostic path, gameplay-planning foundations, and work-in-progress Xbox authentication. **A successfully built APK is not evidence of successful Xbox login, world join, spawn, or autonomous gameplay.** No end-to-end live Android friend-world join has been verified.

## Using a dedicated Xbox bot account on Android

In the runtime-enabled ARM64 debug build, open **Xbox → Sign in with Microsoft** and choose the personal Microsoft account that should appear in Minecraft as the bot. Return to Xbox, enter the host’s gamertag or numeric XUID and tap **Join friend’s world** while the host has multiplayer open and allows that account to join. **Switch Xbox account** starts a new approval flow for another account. **Forget bot account** clears the locally saved credential.

MinePilot uses Microsoft device-code sign-in. No Entra application ID or payment card is needed.

The account session is encrypted with Android Keystore-backed storage. Tokens pass to Android through a private pipe for encryption. The runner checks the Xbox and Bedrock identities, resolves the host and attempts the existing NetherNet join. A successful live spawn still requires device and host verification.

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
| Android dashboard | Implemented; Xbox sign-in and join flow in PR #61 | APK build and on-device UX are separate checks |
| ARM64 Node.js packaging | Implemented diagnostic build path | CI packaging/smoke tests; live device runtime needs validation |
| Bedrock SDK integration | Packaged experimental SDK and transport dependencies | Does not establish a successful friend-world join |
| Microsoft/Xbox login | Device-code sign-in in the runtime-enabled build | User approval and real-account validation required |
| Xbox Live / XSTS exchange | Packaged experimental authentication runtime | Not yet confirmed end-to-end on device |
| Friend identification | Gamertag or numeric host XUID accepted | Requires live Xbox account verification |
| Friend activity / world discovery | Phase 0 confirmed complete | Preserve the confirmed Android/networking milestone; continue regression testing |
| NetherNet / WebRTC transport | Bundled diagnostic dependencies | Real host interoperability unverified |
| Spawn and sustained connection | Phase 0 confirmed complete | Phase 0 is accepted as complete; ongoing QA still protects reconnect and stability |
| Gameplay actions | Physics movement integration in progress | New movement controller and Bedrock collision data are in the integration branch; real-device movement validation remains |
| Autonomous tasks | Planned and partial foundations | No verified autonomous gameplay |
| Background bot service | Android service scaffolding | Sustained connection, notifications and recovery not validated |
| Production release | Not ready | Requires real-account, real-device and world tests |

### Intended end-user experience

1. Install MinePilot on Android.
2. Tap **Sign in with Microsoft** and approve the bot’s separate Xbox account on Microsoft’s sign-in page.
3. Enter the friend’s gamertag or Xbox XUID.
4. Tap **Join friend’s world**. MinePilot discovers the friend’s open world and reports connection stages.
5. Keep the bot connected in the background and issue gameplay tasks.
6. Stop the bot, disconnect, switch accounts or sign out securely.

**Phase 0 is confirmed complete. Phase 1 now focuses on making the bot move reliably in the joined world.**

## Xbox sign-in and bot account

MinePilot uses Microsoft’s device-code sign-in through its packaged Xbox authentication library. A new user taps **Sign in with Microsoft** or **Join friend’s world**. MinePilot automatically opens Microsoft’s official sign-in page with the approval code filled in, displays the code in the app, and waits for the user to approve the account. Xbox authentication and the friend-world attempt then continue automatically. No Entra application ID or payment card is required.

Microsoft approval is still required. MinePilot never asks for the Microsoft password. After successful Xbox and Bedrock identity checks, MinePilot encrypts the account refresh token and gamertag with Android Keystore-backed storage. Later joins attempt to refresh the saved session automatically. **Switch Xbox account** clears the saved identity and starts a fresh sign-in. **Forget saved account** deletes the encrypted account data.

The interactive flow is available in the runtime-enabled ARM64 debug APK. Standard shell builds without the embedded Node runtime cannot complete Xbox sign-in or join a world. Authentication success does not by itself prove a live world join. The host must be online, allow multiplayer, and permit the bot account to join.

## Friend discovery and joining

A **gamertag** is a human-readable Xbox account name. An **XUID** is the numeric Xbox account identifier. The join flow accepts a gamertag or XUID and resolves a gamertag to its Xbox XUID before searching for the friend’s world.

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

The project targets a standalone Android interface with account, friend/world, commands, tasks, settings and diagnostic views. The dashboard includes a bot account card, account switching, friend entry and a prominent join action. The packaged runtime diagnostic executes in an isolated Android process.

Long-running operation requires lifecycle-safe foreground service behavior, a user-visible ongoing notification, explicit stop controls, network/battery handling, recovery after interruption, and secure session cleanup. These are acceptance requirements, **not verified features**.

### Target device considerations

- **Vivo V2544 / 8 GB RAM:** profile sustained memory use, CPU load, thermal behavior and battery impact.
- **ARM64:** use only compatible packaged runtime binaries and dependencies.
- **Android background limits:** test with the app minimized, screen locked and manufacturer battery restrictions applied.
- **Minecraft 1.26.66.1:** confirm protocol and transport interoperability on an actual friend-hosted world.

## AI and gameplay roadmap

| Phase | Status | What completion requires |
| --- | --- | --- |
| **0 — Android and networking** | Complete (owner-confirmed) | Preserve the confirmed Android/networking milestone and prevent regressions |
| **1 — Gameplay controls** | In progress | Physics-backed movement, analog joystick, jump/sprint/sneak, navigation, follow/stop, block interactions and server reconciliation |
| **2 — Autonomous planning** | In progress / foundations | Connect task planner to verified game actions, multi-step goals, persistent world memory and recovery |
| **3 — Advanced gameplay** | Not started | Test building, mining, survival, defense, farming, exploration and storage |
| **4 — Android experience** | In progress | World selection, account controls, task reporting, notifications, accessibility and emergency stop |
| **5 — Stability and optimization** | Not started | Long-duration Android tests, battery/memory profiling, reconnection and resource cleanup |
| **6 — Release and QA** | In progress | Green CI, verified device/world tests, security review and installable signed release |

### Physics-based movement system

The replacement movement architecture is being integrated on
`feature/complete-bedrock-movement`:

- A Bedrock physics simulator handles acceleration, gravity, jumping, friction,
  collision and liquid movement.
- A version-pinned Bedrock 1.26.60 block-state/collision dataset supplies
  per-state collision boxes. Unknown or unloaded blocks stop prediction rather
  than being treated as air.
- A single 20 Hz `PlayerAuthInput` stream carries simulated position, velocity,
  look direction and movement flags.
- Server corrections re-anchor predicted state and replay retained inputs.
- The analog joystick supports 360-degree movement; jump, sprint and sneak
  controls share the same controller used by autonomous navigation.
- The previous experimental movement opt-in and fixed-step input writer are
  removed from the active runtime path.

The vendored physics source is from [LiteLDev/bedboo](https://github.com/LiteLDev/bedboo),
pinned in `vendor/bedboo-physics/NOTICE.md` and distributed under LGPL-3.0.
The collision data retains its Minecraft-data and CloudburstMC attribution.
The upstream physics fixtures are recorded against BDS 1.26.51.1; MinePilot's
protocol-2225 target still needs Android ARM64 and friend-world movement
validation before this system can be described as verified.

Read the [detailed roadmap](docs/ROADMAP.md), the [architecture rebuild and subsystem contracts](docs/ARCHITECTURE_REBUILD.md), and the [runtime function catalog](docs/FUNCTION_CONTRACTS.md). Features such as automatic mining, building, combat, navigation, friend selection and AI decisions are **goals or partial foundations**, not promises about the current APK.

## Download and install an Android APK

1. Open the [GitHub Actions runs](https://github.com/mechy007/MinePilot-AI/actions).
2. Select a successful **Android Node Runtime Probe** workflow run.
3. Expand **Artifacts** and download `minepilot-android-arm64-friend-world-debug`.
4. Extract the ZIP and install the contained APK on a compatible ARM64 Android phone.
5. Record the workflow run, commit SHA and app behavior when reporting an issue.

The artifact is a **debug/test APK**, not a production release. GitHub may require sign-in to download artifacts. Confirm the workflow SHA before installing because a successful build may not contain an unmerged pull request.

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
           +--> Microsoft device-code sign-in
           |         |
           |         +--> Microsoft account --> Xbox Live --> XSTS
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

The diagram describes the intended integration boundaries. Real-account joining and sustained Android connection still require live device and host verification.

## Troubleshooting

| Symptom | Meaning / next action |
| --- | --- |
Use the runtime-enabled ARM64 APK and tap **Sign in with Microsoft**.
| Microsoft page does not open | Return to MinePilot and tap **Open Microsoft sign-in**. The code can also be copied. |
| Saved account stops authenticating | Use **Switch Xbox account** to approve the bot account again. |
| Gamertag cannot join | Check the spelling and Xbox visibility of the friend’s gamertag. |
| Friend/world not found | Check host online status, multiplayer settings, bot account permissions, and Xbox presence visibility |
| SDK smoke tests pass but bot does not join | Packaging tests do not establish live transport interoperability |
| App disconnects when backgrounded | Background session lifecycle and battery/notification behavior still require implementation and testing |
| Sign-in does not finish | Keep MinePilot open until Microsoft approval completes, then check the account’s multiplayer permissions |

For deeper diagnostics see [Android app test guide](docs/ANDROID-APP-STATUS.md) and [desktop integration guide](docs/friend-world-live-join.md). The linked desktop integration guide describes a workstation test, not a verified Android release.

## Security, privacy and responsible testing

- Sign in only through Microsoft's official authentication page.
- Never send Microsoft passwords, access tokens, refresh tokens or device codes to maintainers or issue trackers.
- MinePilot does not require an app-registration ID or client secret for device-code sign-in.
- Test only with Xbox accounts and friend-hosted worlds you are authorized to access.
- Do not interpret a mock identity, CI pass or client-side “connected” message as proof that a host accepted the bot.
- Treat debug artifacts as experimental and avoid using valuable accounts until account/session handling is validated.

## Known blockers and next engineering priorities

1. **Live Xbox verification:** validate sign-in, account refresh and friend-world joining on the target Android device.
2. **Authenticated runtime handoff:** implement a secure Xbox credential bridge to the Bedrock SDK and protected token lifecycle.
3. **Friend-world interoperability:** verify friend lookup, NetherNet connection, Bedrock login, spawn and world updates.
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
- [Voyager + ODYSSEY Bedrock-native learning integration](docs/VOYAGER_ODYSSEY_INTEGRATION.md)
  - Includes an optional, user-enabled local autopilot that sequences supported built-in tasks without external AI prompts or Kaggle.
- [Complete ODYSSEY skill catalog and Bedrock compatibility](docs/ODYSSEY_SKILL_LIBRARY.md)
  - Includes the 183-skill metadata catalog, dependency graph, runtime compatibility evaluation and Android telemetry.

## Contributions and issue reports

When reporting a problem, include the Android device/model, OS version, Minecraft version, APK workflow run and commit SHA, reproduction steps, and **sanitized** diagnostic output. Do not post Xbox credentials, tokens, authorization codes, personal identifiers or screenshots exposing account secrets.

---

**Bottom line:** MinePilot's immediate milestone is **real Xbox sign-in → friend discovery → host-confirmed Bedrock join**. Gameplay automation comes after that connection is genuinely verified.
