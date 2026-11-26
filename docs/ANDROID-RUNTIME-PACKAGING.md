# Android ARM64 runtime packaging

The debug workflow builds a separate ARM64 application ID, `ai.minepilot.app.runtimeprobe`. Its isolated diagnostic processes embed Node.js via JNI and load the packaged Bedrock SDK from the app's private code cache.

## Build inputs

- `scripts/stage-android-node-smoke.sh` downloads the Android ARM64 Node.js Mobile 24.22.1-0 build from the fogtape fork. The script records and verifies SHA-256 hashes for the archive and the Node.js and Node.js Mobile license files.
- `scripts/stage-android-bedrock-sdk.sh` installs `bedrock-protocol` 3.61.0 and `minecraft-data` 3.119.0 with npm lifecycle scripts disabled. It keeps the data used by the 1.26.60 Bedrock codec, packages the JavaScript dependencies with their notices and rejects native Node addons in the bundle.
- The physics movement runtime vendors the Bedrock physics implementation from LiteLDev/bedboo at commit `1d8d2ae4e7b5c062f71a6373b7aede65d6810bb9`. The script downloads the 1.26.60 `blocks`, `blockStates` and `blockCollisionShapes` gzip datasets and verifies their Git blob SHA-1 values before packaging.
- The SDK archive includes `vendor/bedboo-physics/lib`, the pinned collision data and the upstream `COPYING`, `COPYING.LESSER`, `NOTICE.md` and `BEDROCK-DATA-NOTICE.md` files. The physics engine is LGPL-3.0; the data notice retains Minecraft-data and CloudburstMC attributions. No npm `vec3` dependency is required because MinePilot bundles a small compatible vector helper.
- The friend-world path uses the Bedrock SDK’s Prismarine authentication and Xbox services dependencies with NetherNet and Werift. The SDK and those packages declare the MIT license. The build pins direct SDK and codec versions. The transitive npm dependency graph can still change between builds.
- Android CI uses JDK 17, Gradle 8.9, SDK 35, NDK 28.0.13004108 and CMake 3.22.1. It validates ARM64 ELF headers, checks 16 KB alignment, and verifies the diagnostic entrypoints are packaged.

To stage the runtime locally, install dependencies with `npm install --ignore-scripts --omit=optional`, run both staging scripts, and run `gradle -PminepilotNodeSmoke=true :app:assembleDebug :app:testDebugUnitTest` from the `android` directory. See the [friend-world test guide](ANDROID-APP-STATUS.md) for device validation.

## Reference projects

CraftNode’s server hosting and FRP tunnel solve a different connection path from Xbox friend activity and NetherNet. CraftMind’s Kotlin tool contract and its Bedrock pack generator do not provide a live Bedrock client. This milestone uses the project's existing SDK stack. The MinePilot gameplay planner already follows the design documented in [CraftMind-inspired gameplay planning](CRAFTMIND_GAMEPLAY_INTEGRATION.md).
