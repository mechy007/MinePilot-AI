# MinePilot project audit and redesign

Status: active audit on `redesign/full-project-overhaul`.

## Safety baseline

- The branch starts from the latest movement work, including the Android joystick touch-capture fix.
- `main` is untouched.
- PR #121 remains open and unmerged.
- Keep the working Xbox/NetherNet connection path intact. The project owner has confirmed friend-world join and sustained connection; movement is the current critical path.
- Keep the Bedrock physics vendor code, its complete license/notice files, the pinned collision/state datasets, Android runtime staging, and the tests that protect them.

## Initial inventory

| Area | Decision | Reason |
|---|---|---|
| Android dashboard and controls | Keep and redesign | Primary user-facing app and movement surface |
| Xbox sign-in, account storage, friend discovery | Keep | Required for the confirmed friend-world flow |
| Isolated Android Bedrock runtime | Keep | Current live execution path |
| Bedrock movement controller and terrain/collision data | Keep | Current movement implementation; device validation remains |
| Bedrock gameplay bridge, action executors and tests | Keep | Required for world observation and guarded gameplay |
| TypeScript connection/core/gameplay engine | Keep for now | Provides tested contracts and CLI tooling; audit overlap before consolidation |
| Vendor physics engine and notices | Keep | Runtime dependency with licensing obligations |
| Protocol/state datasets | Keep | Required by movement and terrain decoding |
| GitHub Actions workflows | Keep pending workflow-level overlap audit | They cover different engine, SDK, Android packaging and connection checks |
| Detailed architecture/function-contract documents | Keep | They describe safety and runtime contracts |
| Historical phase/PR implementation notes | Archived | Preserved under docs/archive/phase-notes; current docs are linked from docs/archive/README.md |

## Changes already made on this branch

1. Removed the unused legacy `MainActivity` starter screen and its manifest registration. `DashboardActivity` is the actual launcher.
2. Removed the diagnostic-only `MinePilotService` stub, which was launched only by the retired starter screen and did not own a Minecraft session; retained the foreground-service permissions needed by the isolated Xbox sign-in runtime.
3. Reworked the dashboard header and navigation container.
4. Extracted the joystick, camera and touch-action UI into a reusable `ManualControlPanel`; it uses a centered vertical layout, a larger joystick and full-width controls for phone screens.
5. Rewrote the README to distinguish owner-confirmed world joining from movement and autonomous gameplay, which still need validation.
6. Archived superseded connection/dashboard/gameplay planning documents under docs/archive/legacy-plans and docs/archive/phase-notes; removed one obsolete Voyager pointer that only redirected to the current guide.
7. Added a shared Android design-token class and collapsed experimental visualizations behind an optional control.
8. Removed the overlapping Android ARM64 APK workflow after confirming the Android Node Runtime Probe workflow already stages the SDK, runs the contract suite, builds the same debug APK and verifies 16 KB alignment.
9. Archived three superseded experimental movement/spawn-probe notes after checking that the current README, roadmap, architecture and runtime-contract docs do not link to them.

## High-priority redesign work

1. Split the oversized dashboard activity into focused screen and component classes without changing its runtime contract.
2. Make the Control screen prioritize connection state, joystick, camera/actions, vitals and a clear stop action.
3. Move low-frequency diagnostics and experimental visualizations out of the primary control flow.
4. Keep Friends, Skills, Activity and Settings focused, accessible and consistent.
5. Give the Android app one shared design system for colors, typography, spacing, surfaces, buttons and status states.
6. Clarify which gameplay capabilities are available, experimental, preview-only or blocked. Never present a plan as an executed action.
7. Audit the TypeScript engine and embedded Node runtime for genuine duplicate responsibilities before removing or consolidating either.
8. Consolidate overlapping documentation only after checking inbound links and retaining historical implementation details where they remain useful.

## Deletion policy

A file is removable only when its imports, references, manifest entries, runtime staging rules, workflow triggers, tests, generated outputs, license obligations and documentation links have been checked. Uncertain files stay until their role is understood. Do not delete licensed vendor notices, state datasets, protocol fixtures or regression tests as "cleanup."

## Acceptance gates

- Node/TypeScript tests pass.
- Bedrock SDK contract suite passes.
- Android unit tests and ARM64 runtime-enabled APK build pass.
- APK contains the expected runtime, SDK, assets and native libraries and passes 16 KB alignment checks.
- Manual joystick works in the owner's real friend-hosted world, including diagonals, turning, jump/sprint/sneak, stop, release and app focus loss.
- The bot remains connected while controls are used; server corrections and terrain/safety gates behave correctly.
- No claim of full autonomous gameplay until the corresponding actions are verified by server observations in a live world.
- No merge to `main` without explicit owner approval.
