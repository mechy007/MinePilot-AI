# Bedrock connection implementation gate

Target: Minecraft Bedrock 1.26.66.1 on Vivo V2544 (8 GB RAM).

This PR implements only the pure TypeScript connection state machine and owner-session selection.

## Required before live login
1. Pin and inspect Bedrock protocol dependency against protocol 2225.
2. Validate real Xbox session metadata shape before mapping to FriendSession.
3. Implement Microsoft device authorization with protected credential storage.
4. Prove NetherNet friend session signalling and transport on Android ARM64.
5. Prove same-device host remains active while bot runs in background.
6. Capture redacted diagnostics and disconnection reasons.

No credentials or live Xbox requests are made by these modules.
