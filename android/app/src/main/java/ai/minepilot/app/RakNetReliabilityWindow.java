package ai.minepilot.app;

import java.util.HashMap;
import java.util.Map;

/**
 * Bounded, transport-independent RakNet sequence tracking.
 * Sequence numbers are unsigned 24-bit values; does not send UDP packets.
 */
public final class RakNetReliabilityWindow {
    public static final int MASK = 0xFFFFFF;
    public static final int HALF = 0x800000;
    public static final int MAX_PENDING = 512;
    private final Map<Integer, Pending> pending = new HashMap<>();
    private int nextSequence;
    private int highestReceived = -1;
    private int duplicateCount;
    public static final class Pending {
        public final int sequence;
        public final byte[] packet;
        public final long sentAtMillis;
        public final int attempts;
        private Pending(int sequence, byte[] packet, long sentAtMillis, int attempts) {
            this.sequence = sequence;
            this.packet = packet.clone();
            this.sentAtMillis = sentAtMillis;
            this.attempts = attempts;
        }
    }
    public enum ReceiveResult { NEW, DUPLICATE, TOO_OLD }
    public synchronized Pending enqueue(byte[] packet, long nowMillis) {
        if (packet == null || packet.length == 0 || packet.length > 1500
                || nowMillis < 0 || pending.size() >= MAX_PENDING)
            throw new IllegalArgumentException("Invalid or full send window");
        int sequence = nextSequence;
        if (pending.containsKey(sequence)) throw new IllegalStateException("Sequence collision");
        nextSequence = (nextSequence + 1) & MASK;
        Pending p = new Pending(sequence, packet, nowMillis, 1);
        pending.put(sequence, p);
        return p;
    }
    public synchronized boolean acknowledge(int sequence) {
        return valid(sequence) && pending.remove(sequence) != null;
    }
    public synchronized Pending negativeAcknowledge(int sequence, long nowMillis) {
        if (!valid(sequence) || nowMillis < 0) return null;
        Pending previous = pending.get(sequence);
        if (previous == null || previous.attempts >= 5) return null;
        Pending retry = new Pending(sequence, previous.packet, nowMillis, previous.attempts + 1);
        pending.put(sequence, retry);
        return retry;
    }
    public synchronized Pending retransmitIfDue(int sequence, long nowMillis, long timeoutMillis) {
        Pending p = pending.get(sequence);
        if (p == null || nowMillis < p.sentAtMillis || timeoutMillis <= 0
                || nowMillis - p.sentAtMillis < timeoutMillis) return null;
        return negativeAcknowledge(sequence, nowMillis);
    }
    public synchronized ReceiveResult receive(int sequence) {
        if (!valid(sequence)) throw new IllegalArgumentException("Invalid sequence");
        if (highestReceived == -1) {
            highestReceived = sequence;
            return ReceiveResult.NEW;
        }
        int forward = (sequence - highestReceived) & MASK;
        if (forward == 0) { duplicateCount++; return ReceiveResult.DUPLICATE; }
        if (forward < HALF) {
            highestReceived = sequence;
            return ReceiveResult.NEW;
        }
        return ReceiveResult.TOO_OLD;
    }
    public synchronized int pendingCount() { return pending.size(); }
    public synchronized int duplicateCount() { return duplicateCount; }
    private static boolean valid(int sequence) { return sequence >= 0 && sequence <= MASK; }
}
