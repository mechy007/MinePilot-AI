# MinePilot development roadmap

Target: Minecraft Bedrock 1.26.66.1 on the Vivo V2544 with 8 GB RAM.

| Phase | Status | Acceptance work remaining |
| --- | --- | --- |
| 0. Android and networking | In progress | Install the ARM64 debug APK and verify Microsoft/Xbox identity, exact owner discovery, NetherNet login, host-observed spawn, live world packets, and session duration. Integrate the validated path with a production foreground service and secure account lifecycle. |
| 1. Gameplay | In progress | Connect live world, player, inventory and health updates to gameplay. Verify follow, stop, block interaction, simple navigation, and session recovery against server-observed state. |
| 2. Autonomy | In progress | Wire the existing planning foundation to verified gameplay. Add persistent world memory and validate commands, multistep goals and recovery. |
| 3. Advanced gameplay | Not started | Verify representative construction, survival, defensive combat, cooperative farming, exploration and storage tasks. |
| 4. Android experience | In progress | Add authenticated world selection, live session and task reporting, emergency stop, accessibility and settings to the Android dashboard. |
| 5. Stability and optimization | Not started | Profile sustained sessions on the 8 GB target. Measure memory, battery, resource cleanup, recovery and Android lifecycle behavior. |
| 6. Testing and release | In progress | Keep engine, SDK and APK workflows passing and attach a signed release APK once live, device and gameplay acceptance checks pass. |

The [Android test guide](ANDROID-APP-STATUS.md) records the current build, verification procedure and limitations. Check [pull requests](https://github.com/mechy007/MinePilot-AI/pulls) and [workflow runs](https://github.com/mechy007/MinePilot-AI/actions) for current commits, CI results, and APK artifacts.
