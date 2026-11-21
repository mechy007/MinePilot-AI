# CraftNode ↔ MinePilot direct local integration

This integration is an **actual same-device UDP probe**, not a completed Minecraft bot login.

## Setup (Android)

1. Install CraftNode and MinePilot on the same Android device.
2. In CraftNode, install and start a compatible Bedrock server engine. Confirm the console shows **ready** and that UDP port **19132** is bound. A successful APK build or a running service alone is insufficient.
3. Open MinePilot → Settings → **Probe CraftNode local Bedrock server**.
4. MinePilot sends RakNet Open Connection Request 1 and Request 2 to **127.0.0.1:19132** from a background thread and checks the corresponding replies.
5. A successful result proves only that the native UDP socket and RakNet open-connection exchange worked against the local endpoint. It does **not** prove RakNet reliable-session setup, Bedrock login, Xbox identity verification, or world joining.

## Constraints

- Same-device Android apps normally share the device's network stack; loopback is local-only and no public tunnel is needed.
- CraftNode must really be listening on UDP 19132 and its installed engine must support RakNet protocol 11. Versions and engine configurations may differ.
- The probe uses a fresh random client GUID; it does not send account credentials.
- Timeout/failure does not identify the exact cause. Check CraftNode engine readiness, bound port, protocol version, and console logs.
- The probe does not modify CraftNode data or bypass Microsoft authentication.
- The current native handshake closes its UDP socket after Reply 2. A real Bedrock client must keep the connection open and implement reliable RakNet, connected handshake, and the Bedrock protocol.
- A trusted LAN server with server-side Xbox identity checks disabled can help with future protocol testing, but that does not replace Bedrock session packets and should not be exposed publicly.

## Next milestone

Create a persistent RakNet session transport with ACK/NACK, ordered delivery and timeouts; use CraftNode as the controlled endpoint for protocol-level integration tests. Verify on a physical Android device before claiming an end-to-end world join.
