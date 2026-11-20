# Connection configuration

Use `parseConnectionConfig` to validate non-secret connection preferences before creating a Bedrock driver.

- `ownerXuid`: required, decimal Xbox user identifier, represented as a string to avoid JavaScript integer precision loss.
- `accountLabel`: optional display-only identifier, maximum 64 safe characters.
- Unknown fields are rejected. Do not put access tokens, refresh tokens, passwords or device codes into this object.

This configuration does not implement Microsoft authentication, persistence, or a live Bedrock session. Authentication secrets must be managed separately using platform-appropriate secure storage.
