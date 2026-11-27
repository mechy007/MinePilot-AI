package ai.minepilot.app;

import java.io.Closeable;
import java.io.IOException;
import java.util.List;

/**
 * Single-threaded RakNet control dispatcher over an existing UDP transport.
 * The caller must invoke poll() off the UI thread. Payload decoding, login and
 * reliability frame parsing are intentionally outside this layer.
 */
public final class RakNetUdpDispatcher implements Closeable {
    private final BedrockUdpTransport transport;
    private final RakNetControlPlane control = new RakNetControlPlane();
    private volatile boolean closed;

    public RakNetUdpDispatcher(BedrockUdpTransport transport) {
        if (transport == null) throw new IllegalArgumentException("Missing transport");
        this.transport = transport;
    }

    /**
     * Poll one UDP datagram. Returns the accepted RakNet data datagram or null
     * on timeout, control packet, duplicate or unsupported packet.
     */
    public synchronized byte[] poll(long nowMillis) throws IOException {
        ensureOpen();
        if (nowMillis < 0) throw new IllegalArgumentException("Invalid time");
        final byte[] packet;
        try {
            packet = transport.receive();
        } catch (IOException receiveFailure) {
            if (closed || transport.isClosed()) return null;
            throw receiveFailure;
        }
        if (closed || packet == null || packet.length == 0) return null;
        int type = packet[0] & 0xff;
        if (type == RakNetAckCodec.ACK || type == RakNetAckCodec.NACK) {
            final List<RakNetReliabilityWindow.Pending> retries;
            try {
                retries = control.onControl(packet, nowMillis);
            } catch (IllegalArgumentException malformed) {
                return null;
            }
            for (RakNetReliabilityWindow.Pending retry : retries) {
                if (closed) return null;
                try {
                    transport.send(retry.packet);
                } catch (IOException sendFailure) {
                    if (closed || transport.isClosed()) return null;
                    throw sendFailure;
                }
            }
            return null;
        }
        if (type < 0x80 || type > 0x8f || packet.length < 4) return null;
        int sequence = (packet[1] & 255) | ((packet[2] & 255) << 8)
                | ((packet[3] & 255) << 16);
        RakNetControlPlane.Incoming incoming = control.onDatagram(sequence);
        for (byte[] response : incoming.controlPackets) {
            if (closed) return null;
            try {
                transport.send(response);
            } catch (IOException sendFailure) {
                if (closed || transport.isClosed()) return null;
                throw sendFailure;
            }
        }
        return closed || incoming.result != RakNetReceiveWindow.Result.ACCEPTED ? null : packet;
    }

    public synchronized int pendingCount() { return control.pendingCount(); }

    @Override public void close() {
        // Do not acquire the poll() monitor here: poll() can be blocked inside
        // DatagramSocket.receive(). Closing the socket from this thread wakes it.
        if (!closed) {
            closed = true;
            transport.close();
        }
    }

    private void ensureOpen() throws IOException {
        if (closed || transport.isClosed()) throw new IOException("RakNet UDP dispatcher closed");
    }
}
