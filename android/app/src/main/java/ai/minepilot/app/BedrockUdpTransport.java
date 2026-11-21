package ai.minepilot.app;

import java.io.Closeable;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.util.Arrays;

/**
 * UDP transport primitive for Bedrock/RakNet. No login or connected-RakNet framing.
 * One socket per session; receive() is blocking and must run off the Android UI thread.
 */
public final class BedrockUdpTransport implements Closeable {
    public static final int MAX_DATAGRAM = 1492;
    private final DatagramSocket socket;
    private final InetAddress remoteAddress;
    private final int remotePort;
    private volatile boolean closed;

    public BedrockUdpTransport(InetAddress remoteAddress, int remotePort, int timeoutMillis)
            throws IOException {
        if (remoteAddress == null || remoteAddress.isAnyLocalAddress()
                || remoteAddress.isMulticastAddress() || remotePort < 1 || remotePort > 65535
                || timeoutMillis < 1 || timeoutMillis > 60000)
            throw new IllegalArgumentException("Invalid UDP endpoint or timeout");
        this.remoteAddress = remoteAddress;
        this.remotePort = remotePort;
        socket = new DatagramSocket(null);
        try {
            socket.setReuseAddress(false);
            socket.bind(new InetSocketAddress(0));
            socket.setSoTimeout(timeoutMillis);
        } catch (IOException | RuntimeException error) {
            socket.close();
            throw error;
        }
    }

    public synchronized void send(byte[] payload) throws IOException {
        ensureOpen();
        if (payload == null || payload.length == 0 || payload.length > MAX_DATAGRAM)
            throw new IllegalArgumentException("Invalid UDP payload length");
        socket.send(new DatagramPacket(payload, payload.length, remoteAddress, remotePort));
    }

    /** Returns null on timeout; ignores datagrams from other IPs or ports. */
    public byte[] receive() throws IOException {
        ensureOpen();
        byte[] buffer = new byte[MAX_DATAGRAM + 1];
        DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
        while (!closed) {
            try {
                socket.receive(packet);
            } catch (SocketTimeoutException timeout) {
                return null;
            }
            if (!remoteAddress.equals(packet.getAddress()) || packet.getPort() != remotePort) {
                packet.setLength(buffer.length);
                continue;
            }
            if (packet.getLength() > MAX_DATAGRAM) throw new IOException("Oversized UDP datagram");
            return Arrays.copyOfRange(packet.getData(), packet.getOffset(),
                    packet.getOffset() + packet.getLength());
        }
        throw new IOException("UDP transport closed");
    }

    public int localPort() { return socket.getLocalPort(); }
    public boolean isClosed() { return closed; }
    private void ensureOpen() throws IOException {
        if (closed || socket.isClosed()) throw new IOException("UDP transport closed");
    }
    @Override public synchronized void close() {
        closed = true;
        socket.close();
    }
}
