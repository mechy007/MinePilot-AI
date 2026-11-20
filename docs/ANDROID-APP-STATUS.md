# Android app shell status

This is an **installable diagnostic shell**, not a Minecraft bot. It includes an Android activity with start/stop controls and a foreground service notification. It does not contain Xbox login, Bedrock networking, world joining, voice commands, or an embedded Node runtime. The service is deliberately labeled diagnostic to avoid misrepresenting connectivity.

Build with Java 17, Android SDK 35 and Gradle 8.9+ (CI uses the system Gradle; version must be verified). The GitHub Actions Android Shell APK workflow builds and uploads a debug APK if it succeeds.

Next: verify build CI; add reliable Android-hosted Bedrock networking, secure interactive Microsoft login, lifecycle handling, and a live test on the target Android 16 phone. Android foreground-service restrictions and same-device Minecraft joining are unverified. Never claim connection success based on the shell build.
