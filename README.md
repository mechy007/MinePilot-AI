# MinePilot-AI

MinePilot-AI is an Android Bedrock bot under development for the Vivo V2544 (ARM64, 8 GB RAM) and Minecraft Bedrock 1.26.66.1. The first milestone is signing into a separate Microsoft/Xbox account and joining a friend-hosted world from the phone.

The [Android friend-world test guide](docs/ANDROID-APP-STATUS.md) covers the debug APK, sign-in, joining, troubleshooting, and validation. See the [roadmap](docs/ROADMAP.md) for phase status, [runtime packaging](docs/ANDROID-RUNTIME-PACKAGING.md) for dependencies, and the [desktop join guide](docs/friend-world-live-join.md) for the existing Node diagnostic.

## Development

Use Node.js 24, then run `npm install --ignore-scripts --omit=optional` and `npm test`. The Android Node Runtime Probe workflow stages the ARM64 runtime and the Bedrock SDK, runs the bundled tests, and uploads the debug APK. See [GitHub Actions](https://github.com/mechy007/MinePilot-AI/actions) for runs and artifacts.
