package ai.minepilot.app;

import org.junit.Test;
import static org.junit.Assert.*;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.util.Arrays;

public class BedrockUdpTransportTest {
    @Test public void exchangesLoopbackDatagrams() throws Exception {
        InetAddress loopback = InetAddress.getByName("127.0.0.1");
        try (DatagramSocket server = new DatagramSocket(0, loopback);
             BedrockUdpTransport client = new BedrockUdpTransport(loopback, server.getLocalPort(), 300)) {
            client.send(new byte[]{1, 2, 3});
            byte[] buffer = new byte[32];
            DatagramPacket request = new DatagramPacket(buffer, buffer.length);
            server.setSoTimeout(1000);
            server.receive(request);
            assertArrayEquals(new byte[]{1, 2, 3},
                    Arrays.copyOf(request.getData(), request.getLength()));
            server.send(new DatagramPacket(new byte[]{4, 5}, 2, loopback, client.localPort()));
            assertArrayEquals(new byte[]{4, 5}, client.receive());
        }
    }

    @Test public void ignoresUnexpectedSenderAndTimesOut() throws Exception {
        InetAddress loopback = InetAddress.getByName("127.0.0.1");
        try (DatagramSocket expected = new DatagramSocket(0, loopback);
             DatagramSocket other = new DatagramSocket(0, loopback);
             BedrockUdpTransport client = new BedrockUdpTransport(loopback, expected.getLocalPort(), 100)) {
            other.send(new DatagramPacket(new byte[]{9}, 1, loopback, client.localPort()));
            assertNull(client.receive());
        }
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsOversizedPayload() throws Exception {
        InetAddress loopback = InetAddress.getByName("127.0.0.1");
        try (BedrockUdpTransport client = new BedrockUdpTransport(loopback, 19132, 100)) {
            client.send(new byte[BedrockUdpTransport.MAX_DATAGRAM + 1]);
        }
    }

    @Test public void closeIsIdempotent() throws Exception {
        BedrockUdpTransport client = new BedrockUdpTransport(
                InetAddress.getByName("127.0.0.1"), 19132, 100);
        client.close();
        client.close();
        assertTrue(client.isClosed());
    }
}
