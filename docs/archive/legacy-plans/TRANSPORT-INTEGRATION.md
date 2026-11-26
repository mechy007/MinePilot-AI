# Bedrock transport integration

The BedrockConnectionDriver is a protocol-independent bridge from the connection controller to a transport implementation.

**Current status:** no live Microsoft authentication, Xbox friend-session discovery, NetherNet signalling, or Bedrock packet transport is included. Tests use fake transports.

Implementation gate:
- Verify compatible bedrock-protocol and prismarine-auth versions, package licenses, and exact Bedrock protocol version.
- Implement an Android-supported credential flow without logging secrets.
- Map real friend-session metadata to the validated owner XUID.
- Verify same-phone host + bot session networking on a real device.
- Handle cancellation, disconnect and recovery in the eventual transport.
