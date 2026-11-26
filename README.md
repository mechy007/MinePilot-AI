# MinePilot-AI

**An Android-first Minecraft Bedrock companion bot.**

MinePilot runs a separate bot player from an ARM64 Android app. It uses its own Microsoft/Xbox account to find and join a friend's Bedrock world, then provides manual controls and a growing gameplay/AI system. The phone does not need Minecraft or Termux installed.

> **Current state:** The project owner has confirmed that MinePilot can join a friend's world and remain connected. The immediate unfinished area is reliable in-world movement: the physics-backed controller and redesigned touch controls are under active validation. A green APK build does not by itself prove movement or autonomous gameplay.

## Product goals

- **Connect:** sign in with a dedicated Microsoft/Xbox account, find a selected friend and join their Bedrock world.
- **Control:** move with a responsive 360-degree joystick; turn the camera; jump, sprint, sneak and stop.
- **Understand:** observe server-confirmed position, health, hunger, players, inventory and nearby world data.
- **Assist:** plan bounded tasks such as follow, return, gather, shelter and survival routines.
- **Act safely:** use explicit capability checks, user confirmation for consequential actions, server acknowledgements and an emergency stop.
- **Run on Android:** ARM64 first, with attention to memory, battery, lifecycle and background limits.

## Platform

| Item | Target |
|---|---|
| App | Native Android |
| ABI | ARM64 (arm64-v8a) |
| Android minimum | API 28 |
| Primary test device | Vivo V2544, 8 GB RAM |
| Minecraft | Bedrock 1.26.66.1 |
| Protocol baseline | 2225 / Bedrock 1.26.60 codec |
| App ID | ai.minepilot.app |
| Status | Experimental development build |

## Feature status

| Area | Current state |
|---|---|
| Microsoft/Xbox account | Device-code sign-in and encrypted local account storage implemented |
| Friend discovery and world join | Owner-confirmed working on device |
| Sustained world session | Owner-confirmed working |
| Android ARM64 runtime | Packaged and CI-tested |
| Manual movement | Physics controller and analog joystick implemented; live movement validation in progress |
| World observations | Health, hunger, player, inventory and terrain observation foundations |
| AI/gameplay planning | Foundations and guarded previews; not all plans are executable |
| Autonomous gameplay | Experimental; not release-ready |
| Background reliability | Lifecycle and long-duration validation still required |
| Production release | Not ready |

Do not interpret a skill label, plan preview, simulated test or CI pass as proof that the bot can perform that action in a live world. Only server-confirmed outcomes count as completed gameplay.

## Android app navigation

The app is organized around five areas:

- **Control** — world status, manual movement, vitals and active task controls.
- **Friends** — Xbox account, friend list and join flow.
- **Skills** — available, experimental and planned capabilities.
- **Activity** — connection and runtime event history.
- **Settings** — account management and diagnostics.

The UI is being redesigned for phone-sized screens. Movement controls must remain touch-friendly, responsive, and safe when the app loses focus or the world session ends.

## Build and test

### Engine tests

Requires Node.js 24.

```bash
npm install --ignore-scripts --omit=optional
npm test
```

### Android runtime-enabled debug APK

The CI-compatible toolchain uses JDK 17, Android SDK 35, Gradle 8.9, NDK 28.0.13004108 and CMake 3.22.1.

The Android runtime staging and packaging details are in [Android runtime packaging](docs/ANDROID-RUNTIME-PACKAGING.md). The CI workflow builds the ARM64 debug APK and checks its contents and 16 KB alignment.

- [GitHub Actions](https://github.com/mechy007/MinePilot-AI/actions)
- [Android Node Runtime Probe workflow](https://github.com/mechy007/MinePilot-AI/actions/workflows/android-node-smoke.yml)
- [Open pull requests](https://github.com/mechy007/MinePilot-AI/pulls)

Workflow artifacts are debug/test builds, not production releases. Install an APK only after checking the workflow run and commit SHA.

## Architecture at a glance

```text
Android UI
  ├─ Account and friend-world flow
  ├─ Manual controls, status and diagnostics
  └─ User-approved gameplay tasks
       │
Isolated Android Bedrock runtime
  ├─ Microsoft / Xbox identity
  ├─ Bedrock SDK and NetherNet transport
  ├─ Server packet observation
  └─ Shared physics movement controller
       │
Gameplay engine
  ├─ World and inventory observations
  ├─ Capability and safety gates
  ├─ Navigation and task planning
  └─ Skills, learning and outcome verification
```

The Android runtime is the live execution path. The TypeScript engine provides tested connection, orchestration and planning contracts; it must not be mistaken for a second independently verified Android runtime.

## Project documentation

- [Development roadmap](docs/ROADMAP.md) — phases and acceptance criteria.
- [Architecture rebuild](docs/ARCHITECTURE_REBUILD.md) — subsystem boundaries and design decisions.
- [Unified gameplay engine](docs/UNIFIED_GAMEPLAY_ENGINE.md) — gameplay, safety and action contracts.
- [Function contracts](docs/FUNCTION_CONTRACTS.md) — runtime interfaces and behavior.
- [Android app status](docs/ANDROID-APP-STATUS.md) — device verification and movement test procedure.
- [Android runtime packaging](docs/ANDROID-RUNTIME-PACKAGING.md) — SDK staging, native runtime and licenses.
- [Friend-world live join](docs/friend-world-live-join.md) — connection diagnostics.

## Security and account handling

MinePilot uses a separate bot account. Microsoft approval happens on Microsoft's sign-in page; the app does not ask for the account password. Saved account credentials are encrypted using Android Keystore-backed storage. Never share sign-in codes, refresh tokens, XUIDs or private runtime logs publicly.

Gameplay actions must remain bounded and capability-gated. Critical safety conditions and the user's stop command take priority over autonomy.

## Development policy

Work on feature branches, preserve main, keep tests with behavior changes, and verify Android builds. Keep useful implementation history and licensed vendor notices. Remove files only after checking imports, runtime packaging, manifests, CI workflows, tests and documentation links. Merge only after review and explicit project-owner approval.

## Movement reliability status

The movement pipeline has been hardened for Bedrock server-authoritative prediction: sustained manual input no longer depends on a positive acknowledgement packet, rotation-only packets no longer overwrite position, bounded autonomy can continue only from collision-checked predicted progress after a correction grace period, and missing terrain subchunks are retried with throttling. Android diagnostics now distinguish queued commands from runtime execution and show the first missing collision cell. **Live friend-world movement and Android background recovery still require device validation.** See [Movement reliability validation](docs/MOVEMENT-RELIABILITY-VALIDATION.md) for the acceptance checklist and remaining limits.
