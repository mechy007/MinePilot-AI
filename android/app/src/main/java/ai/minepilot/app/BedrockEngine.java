package ai.minepilot.app;

import java.util.Collections;
import java.util.EnumSet;
import java.util.Set;

/**
 * Explicit capability boundary between the Android UI and a future embedded
 * Bedrock engine. No network or Xbox capability is advertised without a runtime.
 */
public interface BedrockEngine {
    enum Capability { MICROSOFT_AUTH, FRIEND_DISCOVERY, WORLD_JOIN, SPAWN, COMMANDS }
    enum State { STOPPED, STARTING, AUTHENTICATING, DISCOVERING, JOINING, SPAWNED, READY, FAILED }
    interface Listener {
        void onStateChanged(State state, String safeCode);
    }
    Set<Capability> capabilities();
    State state();
    void setListener(Listener listener);
    void start(String ownerXuid);
    void command(String name);
    void stop();

    /** Fail-closed implementation until a real embedded runtime is verified. */
    final class Unavailable implements BedrockEngine {
        private Listener listener;
        @Override public Set<Capability> capabilities() { return Collections.emptySet(); }
        @Override public State state() { return State.STOPPED; }
        @Override public void setListener(Listener listener) { this.listener = listener; }
        @Override public void start(String ownerXuid) {
            if (listener != null) listener.onStateChanged(State.FAILED, "ENGINE_NOT_INSTALLED");
        }
        @Override public void command(String name) {
            if (listener != null) listener.onStateChanged(State.FAILED, "ENGINE_NOT_INSTALLED");
        }
        @Override public void stop() {
            if (listener != null) listener.onStateChanged(State.STOPPED, "STOPPED");
        }
    }
}
