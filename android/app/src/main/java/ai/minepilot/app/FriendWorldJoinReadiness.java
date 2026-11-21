package ai.minepilot.app;

import java.util.EnumSet;
import java.util.Set;

/** Strict join readiness gate: a diagnostic APK must never claim it can join a friend world. */
public final class FriendWorldJoinReadiness {
    public enum Requirement { MICROSOFT_AUTH, FRIEND_DISCOVERY, WORLD_JOIN, SPAWN }
    private FriendWorldJoinReadiness() {}

    public static EnumSet<Requirement> missing(Set<BedrockEngine.Capability> capabilities) {
        EnumSet<Requirement> result = EnumSet.noneOf(Requirement.class);
        if (!capabilities.contains(BedrockEngine.Capability.MICROSOFT_AUTH)) result.add(Requirement.MICROSOFT_AUTH);
        if (!capabilities.contains(BedrockEngine.Capability.FRIEND_DISCOVERY)) result.add(Requirement.FRIEND_DISCOVERY);
        if (!capabilities.contains(BedrockEngine.Capability.WORLD_JOIN)) result.add(Requirement.WORLD_JOIN);
        if (!capabilities.contains(BedrockEngine.Capability.SPAWN)) result.add(Requirement.SPAWN);
        return result;
    }

    public static boolean canAttemptJoin(BedrockEngine engine, String ownerXuid) {
        if (engine == null || !missing(engine.capabilities()).isEmpty() || ownerXuid == null
                || !ownerXuid.matches("[0-9]{1,20}")) return false;
        try {
            Long.parseUnsignedLong(ownerXuid);
            return engine.state() == BedrockEngine.State.STOPPED;
        } catch (NumberFormatException error) {
            return false;
        }
    }

    public static String summary(BedrockEngine engine) {
        if (engine == null) return "Bedrock engine missing";
        EnumSet<Requirement> gaps = missing(engine.capabilities());
        return gaps.isEmpty() ? "Join prerequisites reported by engine; live join still unverified"
                : "Join unavailable; missing: " + gaps.toString();
    }
}
