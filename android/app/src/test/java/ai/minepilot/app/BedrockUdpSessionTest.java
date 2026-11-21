package ai.minepilot.app;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;

public class BedrockUdpSessionTest {
    @Test public void loopbackSendReceive() throws Exception {
        InetAddress loopback = InetAddress.getByName("127.0.0.1");
        try (DatagramSocket server = new DatagramSocket(0, loopback);
             BedrockUdpSession session = new BedrockUdpSession(loopback, server.getLocalPort(), 1000)) {
            byte[] request = {1, 2, 3};
            session.send(request);
            byte[] incoming = new byte[32];
            DatagramPacket packet = new DatagramPacket(incoming, incoming.length);
            server.setSoTimeout(1000);
            server.receive(packet);
            assertEquals(3, packet.getLength());
            byte[] response = {4, 5};
            server.send(new DatagramPacket(response, response.length, packet.getAddress(), packet.getPort()));
            assertArrayEquals(response, session.receive());
            assertTrue(session.isOpen());
        }
    }
    @Test public void receiveTimeoutIsNotFailure() throws Exception {
        InetAddress loopback = InetAddress.getByName("127.0.0.1");
        try (DatagramSocket server = new DatagramSocket(0, loopback);
             BedrockUdpSession session = new BedrockUdpSession(loopback, server.getLocalPort(), 20)) {
            assertNull(session.receive());
        }
    }
    @Test(expected = IllegalArgumentException.class)
    public void rejectsOversizedDatagram() throws Exception {
        InetAddress loopback = InetAddress.getByName("127.0.0.1");
        try (BedrockUdpSession session = new BedrockUdpSession(loopback, 19132, 100)) {
            session.send(new byte[BedrockUdpSession.MAX_DATAGRAM + 1]);
        }
    }
    @Test public void closeIsIdempotentAndPreventsSend() throws Exception {
        InetAddress loopback = InetAddress.getByName("127.0.0.1");
        BedrockUdpSession session = new BedrockUdpSession(loopback, 19132, 100);
        session.close();
        session.close();
        assertFalse(session.isOpen());
        try {
            session.send(new byte[]{1});
            fail("Expected closed socket");
        } catch (IOException expected) {
            assertTrue(expected.getMessage().contains("closed"));
        }
    }
}
