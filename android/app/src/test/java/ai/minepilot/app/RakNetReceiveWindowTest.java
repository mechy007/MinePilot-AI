package ai.minepilot.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class RakNetReceiveWindowTest {
    @Test public void tracksMissingAndFillsGaps() {
        RakNetReceiveWindow w = new RakNetReceiveWindow();
        assertEquals(RakNetReceiveWindow.Result.ACCEPTED, w.accept(10).result);
        assertEquals(RakNetReceiveWindow.Result.ACCEPTED, w.accept(13).result);
        assertEquals(11, w.missingRanges().get(0).start);
        assertEquals(12, w.missingRanges().get(0).end);
        assertEquals(10, w.contiguousThrough());
        assertEquals(RakNetReceiveWindow.Result.ACCEPTED, w.accept(12).result);
        assertEquals(11, w.missingRanges().get(0).start);
        w.accept(11);
        assertEquals(13, w.contiguousThrough());
        assertTrue(w.missingRanges().isEmpty());
    }
    @Test public void rejectsDuplicateAndStale() {
        RakNetReceiveWindow w = new RakNetReceiveWindow();
        w.accept(40);
        assertEquals(RakNetReceiveWindow.Result.DUPLICATE, w.accept(40).result);
        assertEquals(RakNetReceiveWindow.Result.TOO_OLD, w.accept(39).result);
        w.accept(42);
        assertEquals(RakNetReceiveWindow.Result.DUPLICATE, w.accept(42).result);
    }
    @Test public void handlesWrapAroundGap() {
        RakNetReceiveWindow w = new RakNetReceiveWindow();
        w.accept(0xFFFFFE);
        w.accept(1);
        assertEquals(2, w.missingRanges().size());
        assertEquals(0, w.missingRanges().get(0).start);
        assertEquals(0, w.missingRanges().get(0).end);
        assertEquals(0xFFFFFF, w.missingRanges().get(1).start);
        w.accept(0xFFFFFF);
        w.accept(0);
        assertEquals(1, w.contiguousThrough());
        assertTrue(w.missingRanges().isEmpty());
    }
    @Test public void boundsFutureSequences() {
        RakNetReceiveWindow w = new RakNetReceiveWindow();
        w.accept(0);
        assertEquals(RakNetReceiveWindow.Result.TOO_FAR_AHEAD, w.accept(1025).result);
    }
    @Test(expected = IllegalArgumentException.class)
    public void rejectsInvalidSequence() {
        new RakNetReceiveWindow().accept(-1);
    }
}
