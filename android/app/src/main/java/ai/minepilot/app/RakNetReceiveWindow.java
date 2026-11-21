package ai.minepilot.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.TreeSet;

/**
 * Bounded 24-bit RakNet datagram receive tracker with reordering and gap detection.
 * Not a replacement for reliable-frame ordering channels or split-packet reassembly.
 */
public final class RakNetReceiveWindow {
    public static final int MASK = 0xFFFFFF;
    public static final int CAPACITY = 1024;
    private static final int HALF = 0x800000;
    private final TreeSet<Integer> receivedOffsets = new TreeSet<>();
    private int base;
    private boolean initialized;

    public enum Result { ACCEPTED, DUPLICATE, TOO_OLD, TOO_FAR_AHEAD }
    public static final class Observation {
        public final Result result;
        public final List<RakNetAckCodec.Range> missing;
        public final int contiguousThrough;
        private Observation(Result result, List<RakNetAckCodec.Range> missing, int contiguousThrough) {
            this.result = result;
            this.missing = Collections.unmodifiableList(missing);
            this.contiguousThrough = contiguousThrough;
        }
    }

    public synchronized Observation accept(int sequence) {
        if (sequence < 0 || sequence > MASK)
            throw new IllegalArgumentException("Invalid 24-bit sequence");
        if (!initialized) {
            initialized = true;
            base = sequence;
            return new Observation(Result.ACCEPTED, Collections.emptyList(), base);
        }
        int distance = (sequence - base) & MASK;
        if (distance == 0) return snapshot(Result.DUPLICATE);
        if (distance >= HALF) return snapshot(Result.TOO_OLD);
        if (distance > CAPACITY) return snapshot(Result.TOO_FAR_AHEAD);
        if (!receivedOffsets.add(distance)) return snapshot(Result.DUPLICATE);
        while (receivedOffsets.remove(1)) {
            base = (base + 1) & MASK;
            TreeSet<Integer> shifted = new TreeSet<>();
            for (int offset : receivedOffsets) shifted.add(offset - 1);
            receivedOffsets.clear();
            receivedOffsets.addAll(shifted);
        }
        return snapshot(Result.ACCEPTED);
    }

    public synchronized List<RakNetAckCodec.Range> missingRanges() {
        if (!initialized || receivedOffsets.isEmpty()) return Collections.emptyList();
        int max = receivedOffsets.last();
        List<RakNetAckCodec.Range> result = new ArrayList<>();
        int runStart = -1;
        for (int offset = 1; offset <= max; offset++) {
            boolean missing = !receivedOffsets.contains(offset);
            if (missing && runStart < 0) runStart = offset;
            if ((!missing || offset == max) && runStart >= 0) {
                int end = missing ? offset : offset - 1;
                int startSeq = (base + runStart) & MASK;
                int endSeq = (base + end) & MASK;
                if (startSeq <= endSeq) {
                    result.add(new RakNetAckCodec.Range(startSeq, endSeq));
                } else {
                    result.add(new RakNetAckCodec.Range(0, endSeq));
                    result.add(new RakNetAckCodec.Range(startSeq, MASK));
                }
                runStart = -1;
            }
        }
        result.sort((x, y) -> Integer.compare(x.start, y.start));
        return result;
    }

    public synchronized int contiguousThrough() { return initialized ? base : -1; }
    private Observation snapshot(Result result) {
        return new Observation(result, missingRanges(), base);
    }
}
