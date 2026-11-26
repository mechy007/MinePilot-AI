# Android dashboard

The runtime-enabled ARM64 debug build includes a dashboard with Home, Xbox, Commands, Tasks, Settings and Logs. The Xbox screen shows the saved bot gamertag, supports account switching and sign-out, accepts a friend’s gamertag or XUID, and starts the friend-world connection. New users can sign in directly or start a join, approve Microsoft’s automatically opened device-code page, and let the app continue the authentication and connection steps.

The refresh token and bot profile are encrypted with Android Keystore-backed storage. Sign-in still requires the user to approve their Microsoft account. Home and Xbox show account/session status. The engine and world join remain experimental and require live Android and host verification.
