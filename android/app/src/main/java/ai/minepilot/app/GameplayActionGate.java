package ai.minepilot.app;

/**
 * Fail-closed boundary between an offline AI plan and a future game executor.
 * This class cannot send packets or claim an action was performed.
 */
public final class GameplayActionGate {
    private GameplayActionGate() {}
    public enum Decision { DENIED, AWAITING_CONFIRMATION, ENGINE_NOT_READY, ELIGIBLE }
    public static final class Context {
        public final boolean connected;
        public final boolean authenticated;
        public final boolean worldReady;
        public final boolean userConfirmed;
        public final boolean emergencyStopped;
        public Context(boolean connected, boolean authenticated, boolean worldReady,
                       boolean userConfirmed, boolean emergencyStopped) {
            this.connected = connected;
            this.authenticated = authenticated;
            this.worldReady = worldReady;
            this.userConfirmed = userConfirmed;
            this.emergencyStopped = emergencyStopped;
        }
    }
    public static Decision evaluate(GameplayPlanner.Plan plan, Context context) {
        if (plan == null || context == null || context.emergencyStopped
                || plan.status != GameplayPlanner.Status.READY_FOR_ENGINE)
            return Decision.DENIED;
        if (plan.requiresConfirmation && !context.userConfirmed)
            return Decision.AWAITING_CONFIRMATION;
        if (!context.connected || !context.authenticated || !context.worldReady)
            return Decision.ENGINE_NOT_READY;
        return Decision.ELIGIBLE;
    }
}
