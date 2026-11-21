package ai.minepilot.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class RakNetReliabilityWindowTest {
    @Test public void tracksAcksAndCopiesPayload() {
        RakNetReliabilityWindow w = new RakNetReliabilityWindow();
        byte[] data = {1, 2, 3};
        RakNetReliabilityWindow.Pending p = w.enqueue(data, 100);
        data[0] = 9;
        assertEquals(1, p.packet[0]);
        assertEquals(1, w.pendingCount());
        assertTrue(w.acknowledge(p.sequence));
        assertFalse(w.acknowledge(p.sequence));
        assertEquals(0, w.pendingCount());
    }
    @Test public void retriesOnTimeoutAndNackWithCap() {
        RakNetReliabilityWindow w = new RakNetReliabilityWindow();
        RakNetReliabilityWindow.Pending p = w.enqueue(new byte[]{1}, 10);
        assertNull(w.retransmitIfDue(p.sequence, 20, 11));
        assertEquals(2, w.retransmitIfDue(p.sequence, 21, 11).attempts);
        assertEquals(3, w.negativeAcknowledge(p.sequence, 22).attempts);
        assertEquals(4, w.negativeAcknowledge(p.sequence, 23).attempts);
        assertEquals(5, w.negativeAcknowledge(p.sequence, 24).attempts);
        assertNull(w.negativeAcknowledge(p.sequence, 25));
    }
    @Test public void receivesMonotonicAndRejectsDuplicates() {
        RakNetReliabilityWindow w = new RakNetReliabilityWindow();
        assertEquals(RakNetReliabilityWindow.ReceiveResult.NEW, w.receive(0xFFFFFE));
        assertEquals(RakNetReliabilityWindow.ReceiveResult.NEW, w.receive(0xFFFFFF));
        assertEquals(RakNetReliabilityWindow.ReceiveResult.NEW, w.receive(0));
        assertEquals(RakNetReliabilityWindow.ReceiveResult.DUPLICATE, w.receive(0));
        assertEquals(RakNetReliabilityWindow.ReceiveResult.TOO_OLD, w.receive(0xFFFFFE));
    }
    @Test(expected = IllegalArgumentException.class)
    public void rejectsOversizedPayload() {
        new RakNetReliabilityWindow().enqueue(new byte[1501], 0);
    }
}
