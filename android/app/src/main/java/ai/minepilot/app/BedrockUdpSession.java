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
 * Bounded UDP transport for one explicitly configured Bedrock endpoint.
 * Does not authenticate, perform RakNet login, or establish a game session.
 */
public final class BedrockUdpSession implements Closeable {
    public static final int MAX_DATAGRAM = 1492;
    private final DatagramSocket socket;
    private final InetAddress peer;
    private final int peerPort;
    private boolean closed;

    public BedrockUdpSession(InetAddress peer, int peerPort, int timeoutMillis) throws IOException {
        if (peer == null || peer.isAnyLocalAddress() || peer.isMulticastAddress()
                || peerPort < 1 || peerPort > 65535 || timeoutMillis < 1 || timeoutMillis > 30000)
            throw new IllegalArgumentException("Invalid UDP endpoint or timeout");
        this.peer = peer;
        this.peerPort = peerPort;
        socket = new DatagramSocket(null);
        try {
            socket.bind(new InetSocketAddress(0));
            socket.connect(peer, peerPort);
            socket.setSoTimeout(timeoutMillis);
        } catch (IOException | RuntimeException ex) {
            socket.close();
            throw ex;
        }
    }

    public synchronized void send(byte[] payload) throws IOException {
        ensureOpen();
        if (payload == null || payload.length == 0 || payload.length > MAX_DATAGRAM)
            throw new IllegalArgumentException("Invalid datagram length");
        byte[] copy = payload.clone();
        socket.send(new DatagramPacket(copy, copy.length, peer, peerPort));
    }

    /** Returns null on timeout, never on a zero-length datagram. */
    public synchronized byte[] receive() throws IOException {
        ensureOpen();
        byte[] buffer = new byte[MAX_DATAGRAM];
        DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
        try {
            socket.receive(packet);
        } catch (SocketTimeoutException timeout) {
            return null;
        }
        if (!packet.getAddress().equals(peer) || packet.getPort() != peerPort)
            throw new IOException("Unexpected datagram source");
        return Arrays.copyOfRange(packet.getData(), packet.getOffset(),
                packet.getOffset() + packet.getLength());
    }

    public synchronized boolean isOpen() { return !closed && !socket.isClosed(); }
    public synchronized int localPort() { return socket.getLocalPort(); }
    @Override public synchronized void close() {
        closed = true;
        socket.close();
    }
    private void ensureOpen() throws IOException {
        if (!isOpen()) throw new IOException("UDP session closed");
    }
}
