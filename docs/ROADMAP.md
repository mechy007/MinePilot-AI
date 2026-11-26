# MinePilot development roadmap

Target: Minecraft Bedrock 1.26.66.1 on the Vivo V2544 with 8 GB RAM.

| Phase | Status | Acceptance work remaining |
| --- | --- | --- |
| 0. Android and networking | Complete (owner-confirmed) | Preserve the accepted Android/networking path with regression coverage for identity, friend discovery, join, spawn, world packets and reconnect. |
| 1. Gameplay controls | In progress | Integrate and validate physics-backed movement, analog joystick, camera look, jump/sprint/sneak, follow, stop, collision-aware navigation and server reconciliation. |
| 2. Autonomy | In progress | Wire the existing planning foundation to verified gameplay. Add persistent world memory and validate commands, multistep goals and recovery. |
| 3. Advanced gameplay | Not started | Verify representative construction, survival, defensive combat, cooperative farming, exploration and storage tasks. |
| 4. Android experience | In progress | Add authenticated world selection, live session and task reporting, emergency stop, accessibility and settings to the Android dashboard. |
| 5. Stability and optimization | Not started | Profile sustained sessions on the 8 GB target. Measure memory, battery, resource cleanup, recovery and Android lifecycle behavior. |
| 6. Testing and release | In progress | Keep engine, SDK and APK workflows passing and attach a signed release APK once live, device and gameplay acceptance checks pass. |


## Physics-based movement integration

The active movement branch replaces the opt-in fixed-step input writer with a
single Bedrock physics controller shared by manual joystick and autonomous
navigation. It uses pinned Bedrock 1.26.60 block-state hashes and collision
shapes from LiteLDev/bedboo, a 20 Hz PlayerAuthInput queue, loaded-terrain
checks, and server correction reconciliation.

The Android controls target 360-degree analog movement, turning, vertical
look, jump, sprint and sneak. Unknown terrain, missing movement authority, and
unacknowledged movement fail closed. CI and Android ARM64 friend-world testing
are still required before declaring real-world movement verified.

The [Android test guide](ANDROID-APP-STATUS.md) records the current build, verification procedure and limitations. Check [pull requests](https://github.com/mechy007/MinePilot-AI/pulls) and [workflow runs](https://github.com/mechy007/MinePilot-AI/actions) for current commits, CI results, and APK artifacts.


## Project-wide redesign and cleanup

The redesign is being carried out on the dedicated `redesign/full-project-overhaul` branch. It preserves the working friend-world connection path and the existing movement implementation while improving the Android control experience and removing obsolete project clutter.

Completed in the first pass:
- Removed the unused legacy starter activity; DashboardActivity is the only launcher.
- Added shared Android design tokens.
- Reworked the dashboard header and navigation surface.
- Made the joystick/control area vertical and phone-width friendly.
- Moved experimental visual analytics and the reconstructed voxel view behind an optional disclosure.
- Rewrote the README around current verified status.
- Archived superseded transport, dashboard and gameplay phase plans without discarding their historical content.

Remaining:
- Split the large dashboard activity into maintainable screen/component classes.
- Audit runtime and TypeScript engine overlap before consolidating.
- Audit every workflow, test, dataset, vendor file and documentation link before further deletion.
- Re-run engine, SDK and Android ARM64 build/test workflows after each meaningful phase.
- Verify joystick movement on a real friend-hosted world before declaring movement complete.
