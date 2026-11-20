# Android ARM64 runtime packaging preflight

PR #22 introduces `RuntimeProbe.inspect(Context)`, a fail-closed check for an Android ARM64 ELF64 runtime packaged in the APK native library directory as `libminepilot_runtime.so`. It distinguishes unsupported ABI, missing library, invalid ELF header and a present ELF header. A present ELF header **does not** establish runtime compatibility, loading, Bedrock networking, Microsoft authentication, or same-phone world joining.

A future build must provide an independently verified Android ARM64 runtime with appropriate redistribution rights, reproducible source/build metadata, an executable entry point and a live on-device integration test. Never copy a desktop Linux Node binary into the APK and claim compatibility. Keep BedrockEngine capabilities disabled until the real runtime and corresponding live functions have been validated.

This PR intentionally does not bundle an unverified native binary or enable Connect.
