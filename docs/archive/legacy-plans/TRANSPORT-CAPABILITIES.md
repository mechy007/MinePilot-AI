# Transport readiness gate

The engine foundation includes simulated connection drivers and mocked tests. They do **not** establish a real Bedrock connection.

Use `UNIMPLEMENTED_TRANSPORT_CAPABILITIES` as the honest default until a production transport exists. A live-connect UI must not be enabled solely because the mock driver reaches `ready`.

A production transport must separately implement and verify Microsoft authentication, Xbox friend-session discovery, Bedrock join, and spawn confirmation. `assertLiveConnectionSupported` checks a supplied declaration; it does not prove the implementation is correct or that same-phone networking works.

Never treat user-editable capability flags as authentication or security boundaries.
