package ai.minepilot.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Transport-independent RakNet ACK/NACK integration. Caller owns UDP I/O and
 * scheduling; never send control datagrams in response to control datagrams.
 */
public final class RakNetControlPlane {
    private static final int MAX_RANGES_PER_PACKET = 200; // <= 1403 bytes
    private final RakNetReceiveWindow receiveWindow = new RakNetReceiveWindow();
    private final RakNetReliabilityWindow sendWindow = new RakNetReliabilityWindow();

    public static final class Incoming {
        public final RakNetReceiveWindow.Result result;
        public final List<byte[]> controlPackets;
        private Incoming(RakNetReceiveWindow.Result result, List<byte[]> packets) {
            this.result = result;
            this.controlPackets = Collections.unmodifiableList(packets);
        }
    }

    /** Observe a RakNet datagram sequence; ACK accepted and duplicate datagrams. */
    public synchronized Incoming onDatagram(int sequence) {
        RakNetReceiveWindow.Observation observation = receiveWindow.accept(sequence);
        List<byte[]> output = new ArrayList<>();
        if (observation.result == RakNetReceiveWindow.Result.ACCEPTED
                || observation.result == RakNetReceiveWindow.Result.DUPLICATE) {
            output.add(RakNetAckCodec.encode(RakNetAckCodec.ACK,
                    Collections.singletonList(new RakNetAckCodec.Range(sequence, sequence))));
        }
        if (observation.result == RakNetReceiveWindow.Result.ACCEPTED) {
            List<RakNetAckCodec.Range> gaps = observation.missing;
            for (int i = 0; i < gaps.size(); i += MAX_RANGES_PER_PACKET) {
                output.add(RakNetAckCodec.encode(RakNetAckCodec.NACK,
                        gaps.subList(i, Math.min(i + MAX_RANGES_PER_PACKET, gaps.size()))));
            }
        }
        return new Incoming(observation.result, output);
    }

    /** Queue an already-framed datagram; caller sends the returned immutable snapshot. */
    public synchronized RakNetReliabilityWindow.Pending queue(byte[] datagram, long nowMillis) {
        if (datagram == null || datagram.length > BedrockUdpTransport.MAX_DATAGRAM)
            throw new IllegalArgumentException("Datagram exceeds transport MTU");
        return sendWindow.enqueue(datagram, nowMillis);
    }

    /** Apply remote ACK/NACK, returning datagrams to resend for NACK only. */
    public synchronized List<RakNetReliabilityWindow.Pending> onControl(byte[] packet, long nowMillis) {
        if (nowMillis < 0) throw new IllegalArgumentException("Invalid time");
        RakNetAckCodec.Message message = RakNetAckCodec.decode(packet);
        List<RakNetReliabilityWindow.Pending> retries = new ArrayList<>();
        for (RakNetAckCodec.Range range : message.ranges) {
            for (int sequence = range.start; sequence <= range.end; sequence++) {
                if (message.type == RakNetAckCodec.ACK) {
                    sendWindow.acknowledge(sequence);
                } else {
                    RakNetReliabilityWindow.Pending retry =
                            sendWindow.negativeAcknowledge(sequence, nowMillis);
                    if (retry != null) retries.add(retry);
                }
            }
        }
        return retries;
    }

    public synchronized int pendingCount() { return sendWindow.pendingCount(); }
    public synchronized int contiguousReceivedThrough() { return receiveWindow.contiguousThrough(); }
}
