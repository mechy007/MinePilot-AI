package ai.minepilot.app;

/** Normalizes the death signal shared by the world and manual-control screens. */
final class WorldSessionStatus {
    private WorldSessionStatus() {}

    static boolean isDead(String lifeState, String assessment) {
        return "dead".equalsIgnoreCase(lifeState == null ? "" : lifeState.trim())
                || "dead".equalsIgnoreCase(assessment == null ? "" : assessment.trim());
    }
}
