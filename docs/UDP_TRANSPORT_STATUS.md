# UDP session foundation

The Android Java module now contains BedrockUdpTransport: a closeable UDP socket with remote endpoint filtering, bounded datagrams, receive timeout, ephemeral local port, and a blocking receive method. Unit tests use local loopback only.

This is **not** a persistent authenticated Minecraft Bedrock session. A caller must own a background worker, handle reconnection and cancellation, perform RakNet offline handshake and connected framing, then integrate ACK/NACK windows and Bedrock login. Minecraft Bedrock 1.26.66.1 protocol compatibility is not yet validated against a real server.

The Vivo V2544 8 GB RAM target should use one socket and one background receive worker per active session, capped packet queues, and avoid polling on the main thread. Profile actual CPU, memory and battery consumption on-device before claiming optimization.
