package ai.minepilot.app;

import org.junit.Test;
import java.util.EnumSet;
import java.util.Set;
import static org.junit.Assert.*;

public final class FriendWorldJoinReadinessTest {
    @Test public void diagnosticEngineNeverClaimsJoinReadiness() {
        BedrockEngine engine = new BedrockEngine.Unavailable();
        assertEquals(4, FriendWorldJoinReadiness.missing(engine.capabilities()).size());
        assertFalse(FriendWorldJoinReadiness.canAttemptJoin(engine, "12345"));
        assertTrue(FriendWorldJoinReadiness.summary(engine).contains("Join unavailable"));
    }

    @Test public void allFourCapabilitiesAreRequired() {
        Set<BedrockEngine.Capability> partial = EnumSet.of(BedrockEngine.Capability.MICROSOFT_AUTH,
                BedrockEngine.Capability.FRIEND_DISCOVERY, BedrockEngine.Capability.WORLD_JOIN);
        assertEquals(EnumSet.of(FriendWorldJoinReadiness.Requirement.SPAWN),
                FriendWorldJoinReadiness.missing(partial));
    }

    @Test public void rejectsInvalidOwnerXuidEvenWithFullCapabilities() {
        BedrockEngine engine = new BedrockEngine() {
            public Set<Capability> capabilities() { return EnumSet.of(Capability.MICROSOFT_AUTH,
                    Capability.FRIEND_DISCOVERY, Capability.WORLD_JOIN, Capability.SPAWN); }
            public State state() { return State.STOPPED; }
            public void setListener(Listener listener) {}
            public void start(String xuid) {}
            public void command(String command) {}
            public void stop() {}
        };
        assertFalse(FriendWorldJoinReadiness.canAttemptJoin(engine, "not-a-xuid"));
        assertFalse(FriendWorldJoinReadiness.canAttemptJoin(engine, "18446744073709551616"));
        assertTrue(FriendWorldJoinReadiness.canAttemptJoin(engine, "18446744073709551615"));
    }
}
