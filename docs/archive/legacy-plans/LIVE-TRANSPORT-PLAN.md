# Live Bedrock transport: implementation and verification plan

## Scope and non-claims

MinePilot currently has a TypeScript connection state machine, mocked driver and capability gate. It **cannot** join a real Minecraft Bedrock world yet. A passing Engine CI suite verifies only the local logic, not Xbox, NetherNet or same-phone compatibility.

Target: Minecraft Bedrock 1.26.66.1, Android 16, Vivo V2544 (8 GB), with Minecraft and MinePilot on the same phone. Bot uses its own Microsoft/Xbox identity and joins an existing owner-hosted friends world. No root, world migration, PC, Minecraft patching or dedicated server.

## Proof sequence

1. **Version and license verification.** Check current releases and licenses of PrismarineJS/bedrock-protocol, PrismarineJS/prismarine-auth and their transitive native modules. Verify actual protocol mapping for Minecraft 1.26.66.1; protocol 2225 is only a hypothesis until verified against a packet implementation.
2. **Separate bot login.** Use Microsoft device-code authorization for a second account with Minecraft Bedrock entitlement. Keep credentials in Android-protected storage, not source files, logs, diagnostics or repository CI.
3. **Owner world discovery.** List Xbox friend sessions using authenticated bot identity, match exact owner XUID, fail closed on missing/ambiguous sessions. Validate privacy/friend permissions.
4. **Join and spawn.** Implement actual NetherNet signalling and RakNet/Bedrock transport as required by the selected library. Confirm player spawn, position and packet round-trip, not merely a socket connection.
5. **Same-phone test.** On the specified Android phone, keep Minecraft foregrounded and MinePilot's engine in an Android foreground service. Verify session discovery, successful join, 10-minute idle stability, screen-lock and app switching, network changes, memory and battery. Document Android background restrictions.
6. **Failure handling.** Verify Stop aborts pending authorization, discovery, join and spawn waits; disconnect closes sockets; retry uses bounded backoff without stale sessions.

## Implementation boundaries

- `BedrockSessionTransport` remains the abstraction for authentication, session listing, joining and spawn confirmation.
- `createLiveConnectionController` defaults to blocking unsupported transports; a manually asserted capability report is **not** a substitute for real integration tests.
- Use adapters around third-party libraries rather than copying their code without checking licenses.
- Add protocol-level integration tests with a controlled test world and a device-level test checklist. Mock tests must be clearly labelled as such.
- Do not promise same-phone world joining until a physical-device test succeeds.

## Release gates

**Gate A:** Node desktop test joins a compatible Bedrock test world with separate credentials.
**Gate B:** Xbox friend-session join works with an owner-hosted world.
**Gate C:** Android ARM64 embedded engine authenticates, joins and survives app lifecycle changes.
**Gate D:** Android UI shows real connection state and Stop reliably disconnects.

Until Gates A–C pass, the application is a connection foundation, not a functioning Bedrock companion.
