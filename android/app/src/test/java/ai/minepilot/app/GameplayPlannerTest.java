package ai.minepilot.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class GameplayPlannerTest {
    @Test public void validIntentIsOnlyAPlan() {
        GameplayPlanner.Plan plan = GameplayPlanner.plan(GameplayPlanner.VERSION, "FOLLOW", "Steve");
        assertEquals(GameplayPlanner.Status.READY_FOR_ENGINE, plan.status);
        assertEquals("follow", plan.action);
        assertFalse(plan.requiresConfirmation);
        assertTrue(plan.message.contains("execution unavailable"));
    }
    @Test public void persistentActionsRequireConfirmation() {
        assertTrue(GameplayPlanner.plan(GameplayPlanner.VERSION, "mine", "diamond").requiresConfirmation);
        assertTrue(GameplayPlanner.plan(GameplayPlanner.VERSION, "build", "house").requiresConfirmation);
    }
    @Test public void rejectsInjectionAndUnsupportedVersions() {
        assertEquals(GameplayPlanner.Status.REJECTED,
                GameplayPlanner.plan("craftmind.bridge.v1", "follow", "").status);
        assertEquals(GameplayPlanner.Status.UNSUPPORTED,
                GameplayPlanner.plan(GameplayPlanner.VERSION, "shell", "").status);
        assertEquals(GameplayPlanner.Status.REJECTED,
                GameplayPlanner.plan(GameplayPlanner.VERSION, "follow", "../secrets").status);
        assertEquals(GameplayPlanner.Status.REJECTED,
                GameplayPlanner.plan(GameplayPlanner.VERSION, "follow", "a\ncommand").status);
    }
}
