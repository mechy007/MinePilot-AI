# Friend-world live join boundary

MinePilot's Android debug runtime uses one authenticated Bedrock client and one NetherNet transport for a selected Xbox-hosted Bedrock friend world. The runtime is not considered live-world validated until it has been exercised on a real Android device against an Xbox-hosted friend world.

## Production Android path

The active Android session entry point is `scripts/android-friend-world-session.cjs`. Friend-world discovery and Xbox membership are implemented in `scripts/android-friend-world-join.cjs`; the helper is packaged beside the session entry point in the Android Node SDK archive.

The join sequence is:

1. Authenticate the Xbox profile and verify that the Bedrock identity belongs to the same XUID.
2. Query the signed-in profile's activity handles and select exactly one handle whose owner identity matches the requested friend XUID and whose Bedrock protocol is compatible.
3. Select a supported transport from the handle's `SupportedConnections`. Prefer ConnectionType 7 with a valid `PmsgId` and JSON-RPC signalling; fall back to the supported legacy NetherNet ID route when the PmsgId is absent.
4. Open one Xbox RTA socket and subscribe to the session-directory connections resource.
5. Join the selected MPSD activity handle using its handle ID and the live RTA ConnectionId. The membership subscription remains open for the lifetime of the Bedrock session.
6. Wait for the signed-in bot XUID's host nonce. When available, add it to the Bedrock client identity's `ClientData.Nonce` and sign the updated user chain.
7. Start the Bedrock client with the selected peer route. For JSON-RPC, the peer ID is the host PmsgId; the local NetherNet ID remains the ID advertised in the offer.
8. On RTA reconnect, update the MPSD membership with the new connection ID. On stop, disconnect or failure, close the RTA subscription and leave the MPSD session.

The Android runtime must not create a second Xbox-authenticated Bedrock client, a second NetherNet session, a duplicate movement queue, or a parallel physics engine.

## Legacy SDK adapter

`src/connection/prismarine-world-client.ts` remains as a narrow SDK-discovery/contract adapter for tests. Its built-in Prismarine `world` join path is not the production Android friend-world path. Do not use a successful unit test of this adapter as evidence that Android friend-world joining works.

## What CI proves—and does not prove

CI can verify the MPSD request contract, owner-handle selection, nonce handling, JSON-RPC peer routing, cleanup, APK packaging, Android Node runtime startup, and the pinned Bedrock serializer boundary.

CI cannot prove that Xbox accepts a real membership request, that a particular friend's world advertises the expected connection metadata, that ICE succeeds on the user's network, or that the server accepts movement frames. Those require an installed runtime-enabled Android debug APK and a real Xbox-hosted friend world.

The current protocol target is pinned to Bedrock 1.26.60. Compatibility with other live server/client versions, including later 1.26.66.x builds, remains unverified until tested against those versions.

## Live-device acceptance checklist

- [ ] Install the newest runtime-enabled Android debug APK.
- [ ] Complete Microsoft/Xbox sign-in and confirm the displayed gamertag/XUID is the expected account.
- [ ] Select the intended friend's XUID and join their active world.
- [ ] Confirm the runtime reaches the spawned state and receives real chunk/player observations.
- [ ] Send one short manual movement input and confirm the Xbox-hosted server changes the player's position.
- [ ] Release input and confirm a neutral authoritative-input frame is sent.
- [ ] Stop/restart the session and confirm the old RTA membership, NetherNet connection and movement queue are cleaned up before retry.

Until the checklist's live movement step passes, report the runtime as CI-validated but not live-world validated. Do not claim that movement is fixed or that autonomous gameplay is ready.
