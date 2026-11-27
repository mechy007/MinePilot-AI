package ai.minepilot.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class WorldSessionStatusTest {
    @Test public void detectsDeathFromProviderAssessmentWhenLifeStateAliasIsAbsent() {
        assertTrue(WorldSessionStatus.isDead("", "dead"));
    }

    @Test public void acceptsEitherDeathSignalCaseInsensitively() {
        assertTrue(WorldSessionStatus.isDead("DEAD", ""));
        assertTrue(WorldSessionStatus.isDead(null, " Dead "));
    }

    @Test public void doesNotTreatOtherSurvivalAssessmentsAsDeath() {
        assertFalse(WorldSessionStatus.isDead("", "needs_food"));
        assertFalse(WorldSessionStatus.isDead(null, null));
    }
}
