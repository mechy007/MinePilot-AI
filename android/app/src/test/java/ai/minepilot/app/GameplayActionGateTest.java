package ai.minepilot.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class GameplayActionGateTest {
    private final GameplayPlanner.Plan follow =
            GameplayPlanner.plan(GameplayPlanner.VERSION, "follow", "Steve");
    private final GameplayPlanner.Plan mine =
            GameplayPlanner.plan(GameplayPlanner.VERSION, "mine", "stone");
    @Test public void failsClosedWithoutSession() {
        assertEquals(GameplayActionGate.Decision.ENGINE_NOT_READY,
                GameplayActionGate.evaluate(follow,
                        new GameplayActionGate.Context(false, false, false, false, false)));
    }
    @Test public void requiresConfirmationBeforeDestructiveActions() {
        assertEquals(GameplayActionGate.Decision.AWAITING_CONFIRMATION,
                GameplayActionGate.evaluate(mine,
                        new GameplayActionGate.Context(true, true, true, false, false)));
    }
    @Test public void emergencyStopOverridesEverything() {
        assertEquals(GameplayActionGate.Decision.DENIED,
                GameplayActionGate.evaluate(follow,
                        new GameplayActionGate.Context(true, true, true, true, true)));
    }
    @Test public void eligibleDoesNotMeanExecuted() {
        assertEquals(GameplayActionGate.Decision.ELIGIBLE,
                GameplayActionGate.evaluate(follow,
                        new GameplayActionGate.Context(true, true, true, false, false)));
    }
    @Test public void rejectsInvalidPlans() {
        assertEquals(GameplayActionGate.Decision.DENIED,
                GameplayActionGate.evaluate(
                        GameplayPlanner.plan(GameplayPlanner.VERSION, "shell", ""),
                        new GameplayActionGate.Context(true, true, true, true, false)));
    }
}
