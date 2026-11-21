# Persistent UDP transport (PR #41)

BedrockUdpSession owns a single connected UDP socket bound to an ephemeral local port and restricted to a configured remote IP/port. It supports repeated datagram send/receive operations, bounded payloads, timeouts and deterministic cleanup. Loopback unit tests exercise basic exchange, timeout, payload bounds and closure.

This is a **socket transport**, not a completed RakNet or Bedrock session. It does not send gameplay actions, perform encryption, authentication, RakNet framing, keepalives or world login. The existing RakNet reliability-window and ACK/NACK codecs are not yet wired to this socket.

Next: implement a cancellable asynchronous receive loop, wire datagram classification and ACK/NACK handling, integrate retransmission timers, and test loss/reordering against a controlled server. Never claim gameplay connectivity from a successful socket or CI test.
