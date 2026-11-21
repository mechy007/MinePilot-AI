package ai.minepilot.app;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * CraftMind-inspired deterministic gameplay intent gate.
 * Produces validated plans, NEVER executes world actions or claims success.
 * No dependency on CraftNode, CraftMind Studio, credentials or network.
 */
public final class GameplayPlanner {
    private GameplayPlanner() {}
    public static final String VERSION = "minepilot.gameplay.v1";
    private static final Set<String> ALLOWED = Collections.unmodifiableSet(
            new HashSet<>(Arrays.asList("follow", "come", "protect", "mine",
                    "gather", "craft", "build", "explore", "return")));
    public enum Status { READY_FOR_ENGINE, REJECTED, UNSUPPORTED }
    public static final class Plan {
        public final Status status;
        public final String action;
        public final String target;
        public final String message;
        public final boolean requiresConfirmation;
        private Plan(Status status, String action, String target, String message,
                     boolean requiresConfirmation) {
            this.status = status;
            this.action = action;
            this.target = target;
            this.message = message;
            this.requiresConfirmation = requiresConfirmation;
        }
    }
    public static Plan plan(String version, String action, String target) {
        if (!VERSION.equals(version))
            return new Plan(Status.REJECTED, "", "", "Unsupported plan version", false);
        if (action == null || action.length() > 32)
            return new Plan(Status.REJECTED, "", "", "Invalid action", false);
        String normalized = action.trim().toLowerCase(Locale.ROOT);
        if (!ALLOWED.contains(normalized))
            return new Plan(Status.UNSUPPORTED, "", "", "Action not allowlisted", false);
        String safeTarget = target == null ? "" : target.trim();
        if (safeTarget.length() > 64 || !safeTarget.matches("[A-Za-z0-9 _-]*"))
            return new Plan(Status.REJECTED, "", "", "Invalid target", false);
        boolean confirm = normalized.equals("mine") || normalized.equals("build")
                || normalized.equals("craft") || normalized.equals("protect");
        return new Plan(Status.READY_FOR_ENGINE, normalized, safeTarget,
                "Validated offline intent; execution unavailable until a Bedrock session exists",
                confirm);
    }
}
