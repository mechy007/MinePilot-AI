# Android engine integration contract

The Java `BedrockEngine` interface defines a future embedded runtime boundary: capability reporting, connection state, start, command, stop and sanitized status callbacks. `Unavailable` explicitly reports zero capabilities and refuses live operations. This prevents UI code from advertising Xbox sign-in or world-join without a real implementation.

## Next technical gate

1. Choose and verify a legally redistributable Android ARM64 Bedrock runtime. Existing Node 24 `bedrock-protocol` tests run on Linux and do not establish Android compatibility.
2. Package the runtime into the APK or AAB with ABI-specific assets and reproducible build checks.
3. Wire Microsoft device-code authentication and secure local token storage without publishing credentials.
4. Verify Xbox friend-world discovery, join and spawn using a second Xbox identity, including same-phone testing.
5. Implement command transport and stop/cancellation; only then enable corresponding UI controls.

The current dashboard and diagnostic service do not constitute a live bot. No runtime is embedded in this PR.
