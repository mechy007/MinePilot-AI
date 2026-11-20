# Experimental authenticated friend-world client

`PrismarineWorldClient` invokes the real `bedrock-protocol.createClient` API with `offline: false` and `world.pickSession`. The upstream API supports authenticated Xbox friend-world discovery and NetherNet. This is a **first actual network-library integration**, not a completed mobile bot.

Before running a live experiment, install a compatible release of `bedrock-protocol` with `npm install bedrock-protocol`. This dependency is deliberately not pinned until its release, licensing and Bedrock 1.26.66.1 compatibility are verified. The CI tests inject an event-emitting fake and **do not** connect to Minecraft.

The session selector requires a unique owner XUID in `hostXuid` or `customProperties.hostXuid`. Upstream `WorldSession` does **not** guarantee either field, so this implementation deliberately fails closed until real session metadata is captured and the authoritative owner identifier is verified. Never substitute gamertag or choose the first session.

The module's `connectAndSpawn` resolves only on the upstream `spawn` event, aborts and closes on errors, and exposes `disconnect`. Authentication tokens must be stored securely by the eventual Android host. This is not yet wired into the four-stage `BedrockSdkBridge`; the upstream library owns authentication and discovery internally.

Next: verify actual friend-session metadata and supported version on a test machine, implement credential callback/secure cache and join an owner-hosted world, then test same-phone Android execution. No live join or Android build is claimed.
