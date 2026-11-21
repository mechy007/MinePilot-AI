package ai.minepilot.app;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.Arrays;

public class RakNetAckCodecTest {
    @Test public void ackSingleAndRangeRoundTrip() {
        byte[] wire = RakNetAckCodec.encode(RakNetAckCodec.ACK, Arrays.asList(
                new RakNetAckCodec.Range(0, 0), new RakNetAckCodec.Range(5, 7)));
        RakNetAckCodec.Message parsed = RakNetAckCodec.decode(wire);
        assertEquals(RakNetAckCodec.ACK, parsed.type);
        assertEquals(2, parsed.ranges.size());
        assertEquals(0, parsed.ranges.get(0).start);
        assertEquals(7, parsed.ranges.get(1).end);
    }
    @Test public void nackTriadLittleEndian() {
        byte[] wire = RakNetAckCodec.encode(RakNetAckCodec.NACK,
                Arrays.asList(new RakNetAckCodec.Range(0x123456, 0x123458)));
        assertArrayEquals(new byte[]{(byte)0xA0, 0, 1, 0, 0x56, 0x34, 0x12,
                0x58, 0x34, 0x12}, wire);
    }
    @Test(expected = IllegalArgumentException.class)
    public void rejectOverlappingRanges() {
        RakNetAckCodec.encode(RakNetAckCodec.ACK, Arrays.asList(
                new RakNetAckCodec.Range(1, 4), new RakNetAckCodec.Range(4, 5)));
    }
    @Test(expected = IllegalArgumentException.class)
    public void rejectTruncatedRecord() {
        RakNetAckCodec.decode(new byte[]{(byte)0xC0, 0, 1, 0, 1, 2});
    }
    @Test(expected = IllegalArgumentException.class)
    public void rejectTrailingBytes() {
        RakNetAckCodec.decode(new byte[]{(byte)0xC0, 0, 1, 1, 0, 0, 0, 99});
    }
    @Test(expected = IllegalArgumentException.class)
    public void rejectHugeRange() {
        RakNetAckCodec.decode(new byte[]{(byte)0xC0, 0, 1, 0, 0, 0, 0, (byte)0xff,
                (byte)0xff, (byte)0xff});
    }
}
