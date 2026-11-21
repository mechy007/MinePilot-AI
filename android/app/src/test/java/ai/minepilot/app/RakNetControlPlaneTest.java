package ai.minepilot.app;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.Collections;
import java.util.List;

public class RakNetControlPlaneTest {
    @Test public void missingPacketTriggersNackAndAck() {
        RakNetControlPlane control = new RakNetControlPlane();
        assertEquals(1, control.onDatagram(10).controlPackets.size());
        RakNetControlPlane.Incoming result = control.onDatagram(12);
        assertEquals(RakNetReceiveWindow.Result.ACCEPTED, result.result);
        assertEquals(2, result.controlPackets.size());
        RakNetAckCodec.Message ack = RakNetAckCodec.decode(result.controlPackets.get(0));
        RakNetAckCodec.Message nack = RakNetAckCodec.decode(result.controlPackets.get(1));
        assertEquals(RakNetAckCodec.ACK, ack.type);
        assertEquals(12, ack.ranges.get(0).start);
        assertEquals(RakNetAckCodec.NACK, nack.type);
        assertEquals(11, nack.ranges.get(0).start);
        assertEquals(11, nack.ranges.get(0).end);
        control.onDatagram(11);
        assertEquals(12, control.contiguousReceivedThrough());
    }

    @Test public void ackRemovesPendingAndNackRequestsRetry() {
        RakNetControlPlane control = new RakNetControlPlane();
        RakNetReliabilityWindow.Pending first = control.queue(new byte[]{1}, 10);
        RakNetReliabilityWindow.Pending second = control.queue(new byte[]{2}, 10);
        assertEquals(2, control.pendingCount());
        byte[] nack = RakNetAckCodec.encode(RakNetAckCodec.NACK,
                Collections.singletonList(new RakNetAckCodec.Range(second.sequence, second.sequence)));
        List<RakNetReliabilityWindow.Pending> retries = control.onControl(nack, 20);
        assertEquals(1, retries.size());
        assertEquals(2, retries.get(0).attempts);
        assertEquals(second.sequence, retries.get(0).sequence);
        byte[] ack = RakNetAckCodec.encode(RakNetAckCodec.ACK,
                Collections.singletonList(new RakNetAckCodec.Range(first.sequence, second.sequence)));
        assertTrue(control.onControl(ack, 30).isEmpty());
        assertEquals(0, control.pendingCount());
    }

    @Test public void duplicateIsAckedWithoutNack() {
        RakNetControlPlane control = new RakNetControlPlane();
        control.onDatagram(7);
        RakNetControlPlane.Incoming duplicate = control.onDatagram(7);
        assertEquals(RakNetReceiveWindow.Result.DUPLICATE, duplicate.result);
        assertEquals(1, duplicate.controlPackets.size());
        assertEquals(RakNetAckCodec.ACK, RakNetAckCodec.decode(duplicate.controlPackets.get(0)).type);
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsDatagramBeyondTransportLimit() {
        new RakNetControlPlane().queue(new byte[BedrockUdpTransport.MAX_DATAGRAM + 1], 0);
    }

    @Test public void oldDatagramsDoNotProduceControlStorm() {
        RakNetControlPlane control = new RakNetControlPlane();
        control.onDatagram(100);
        RakNetControlPlane.Incoming old = control.onDatagram(99);
        assertEquals(RakNetReceiveWindow.Result.TOO_OLD, old.result);
        assertTrue(old.controlPackets.isEmpty());
    }
}
