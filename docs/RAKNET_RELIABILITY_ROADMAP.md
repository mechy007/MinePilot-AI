# RakNet reliable transport — incremental implementation

This phase introduces a pure Java 24-bit sequence/window model with bounded outstanding packets, ACK removal, NACK/timeout retries and a maximum retry count. It is independent of any companion application.

**Not yet implemented:** connected RakNet datagram framing, ACK/NACK range serialization, sliding receive bitmap, out-of-order reassembly, split packets, ordering channels, congestion control, UDP integration or persistent sessions. The current receive tracker is intentionally monotonic and cannot detect all out-of-order duplicates.

A successful unit test or Android build is **not** evidence of joining a Bedrock world.

Next work: implement protocol-correct ACK/NACK range codecs and receive-gap tracking, then connect the window to a persistent native UDP socket and test packet loss/reordering against a controlled server.
