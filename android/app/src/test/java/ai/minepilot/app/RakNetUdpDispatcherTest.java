package ai.minepilot.app;

import org.junit.Test;
import static org.junit.Assert.*;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;

public class RakNetUdpDispatcherTest {
    private static byte[] receive(DatagramSocket socket) throws Exception {
        byte[] bytes = new byte[1500];
        DatagramPacket packet = new DatagramPacket(bytes, bytes.length);
        socket.receive(packet);
        byte[] result = new byte[packet.getLength()];
        System.arraycopy(packet.getData(), 0, result, 0, result.length);
        return result;
    }
    @Test public void acknowledgesDataAndNacksGap() throws Exception {
        InetAddress host = InetAddress.getByName("127.0.0.1");
        try (DatagramSocket server = new DatagramSocket(0, host);
             RakNetUdpDispatcher dispatcher = new RakNetUdpDispatcher(
                     new BedrockUdpTransport(host, server.getLocalPort(), 300))) {
            server.setSoTimeout(1000);
            byte[] first = { (byte)0x84, 10, 0, 0, 42 };
            server.send(new DatagramPacket(first, first.length, host,
                    dispatcherPort(dispatcher)));
            assertArrayEquals(first, dispatcher.poll(10));
            assertEquals(RakNetAckCodec.ACK, RakNetAckCodec.decode(receive(server)).type);
            byte[] third = { (byte)0x84, 12, 0, 0, 43 };
            server.send(new DatagramPacket(third, third.length, host,
                    dispatcherPort(dispatcher)));
            assertArrayEquals(third, dispatcher.poll(20));
            assertEquals(12, RakNetAckCodec.decode(receive(server)).ranges.get(0).start);
            RakNetAckCodec.Message missing = RakNetAckCodec.decode(receive(server));
            assertEquals(RakNetAckCodec.NACK, missing.type);
            assertEquals(11, missing.ranges.get(0).start);
        }
    }
    private static int dispatcherPort(RakNetUdpDispatcher dispatcher) throws Exception {
        java.lang.reflect.Field f = RakNetUdpDispatcher.class.getDeclaredField("transport");
        f.setAccessible(true);
        return ((BedrockUdpTransport) f.get(dispatcher)).localPort();
    }
    @Test public void timeoutAndMalformedControlAreIgnored() throws Exception {
        InetAddress host = InetAddress.getByName("127.0.0.1");
        try (DatagramSocket server = new DatagramSocket(0, host);
             RakNetUdpDispatcher dispatcher = new RakNetUdpDispatcher(
                     new BedrockUdpTransport(host, server.getLocalPort(), 30))) {
            assertNull(dispatcher.poll(1));
            byte[] malformed = {(byte)0xc0, 0};
            server.send(new DatagramPacket(malformed, malformed.length, host,
                    dispatcherPort(dispatcher)));
            assertNull(dispatcher.poll(2));
        }
    }
}
