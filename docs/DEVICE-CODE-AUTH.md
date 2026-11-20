# Device-code login integration

The experimental `PrismarineWorldClient` accepts an `onMsaCode` callback to surface Microsoft device-code login to a future Android UI and `profilesFolder` to place the authentication cache in app-private storage. Do not log device codes or tokens, commit the cache, or store credentials in public external storage. This change forwards options to bedrock-protocol; it does not implement an Android secure storage bridge or test live login.

The application must provide an Android app-private path and show the device authorization URL/code through its own UI. Never use a personal Microsoft account already active in Minecraft as the bot identity; the bot needs a separate account. Upstream compatibility and exact Minecraft 1.26.66.1 support remain unverified.
