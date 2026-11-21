package ai.minepilot.app;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** RakNet ACK (0xC0) / NACK (0xA0) datagram record codec. */
public final class RakNetAckCodec {
    public static final int ACK = 0xC0;
    public static final int NACK = 0xA0;
    public static final int MAX_RECORDS = 512;
    public static final int MAX_SEQUENCES = 4096;
    private static final int MASK = 0xFFFFFF;
    private RakNetAckCodec() {}

    public static final class Range {
        public final int start;
        public final int end;
        public Range(int start, int end) {
            if (start < 0 || end < start || end > MASK)
                throw new IllegalArgumentException("Invalid range");
            this.start = start;
            this.end = end;
        }
    }
    public static final class Message {
        public final int type;
        public final List<Range> ranges;
        private Message(int type, List<Range> ranges) {
            this.type = type;
            this.ranges = Collections.unmodifiableList(ranges);
        }
    }
    public static byte[] encode(int type, List<Range> ranges) {
        validateType(type);
        if (ranges == null || ranges.isEmpty() || ranges.size() > MAX_RECORDS)
            throw new IllegalArgumentException("Invalid record count");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(type);
        out.write((ranges.size() >>> 8) & 255);
        out.write(ranges.size() & 255);
        int lastEnd = -1;
        long total = 0;
        for (Range r : ranges) {
            if (r == null || r.start <= lastEnd)
                throw new IllegalArgumentException("Ranges must be sorted and non-overlapping");
            total += (long) r.end - r.start + 1;
            if (total > MAX_SEQUENCES) throw new IllegalArgumentException("Too many sequences");
            boolean singleton = r.start == r.end;
            out.write(singleton ? 1 : 0);
            writeTriad(out, r.start);
            if (!singleton) writeTriad(out, r.end);
            lastEnd = r.end;
        }
        return out.toByteArray();
    }
    public static Message decode(byte[] packet) {
        if (packet == null || packet.length < 7)
            throw new IllegalArgumentException("Truncated packet");
        int type = packet[0] & 255;
        validateType(type);
        int count = ((packet[1] & 255) << 8) | (packet[2] & 255);
        if (count == 0 || count > MAX_RECORDS)
            throw new IllegalArgumentException("Invalid record count");
        int offset = 3;
        int lastEnd = -1;
        long total = 0;
        List<Range> ranges = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            if (offset + 4 > packet.length) throw new IllegalArgumentException("Truncated record");
            int flag = packet[offset++] & 255;
            if (flag != 0 && flag != 1) throw new IllegalArgumentException("Invalid record flag");
            int start = readTriad(packet, offset);
            offset += 3;
            int end = start;
            if (flag == 0) {
                if (offset + 3 > packet.length) throw new IllegalArgumentException("Truncated range");
                end = readTriad(packet, offset);
                offset += 3;
            }
            Range range = new Range(start, end);
            if (range.start <= lastEnd) throw new IllegalArgumentException("Unsorted/overlapping records");
            total += (long) end - start + 1;
            if (total > MAX_SEQUENCES) throw new IllegalArgumentException("Too many sequences");
            ranges.add(range);
            lastEnd = end;
        }
        if (offset != packet.length) throw new IllegalArgumentException("Trailing bytes");
        return new Message(type, ranges);
    }
    private static void validateType(int type) {
        if (type != ACK && type != NACK) throw new IllegalArgumentException("Unknown packet type");
    }
    private static void writeTriad(ByteArrayOutputStream out, int value) {
        out.write(value & 255);
        out.write((value >>> 8) & 255);
        out.write((value >>> 16) & 255);
    }
    private static int readTriad(byte[] data, int offset) {
        return (data[offset] & 255) | ((data[offset + 1] & 255) << 8)
                | ((data[offset + 2] & 255) << 16);
    }
}
