package ai.minepilot.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.UUID;
import org.json.JSONObject;

/**
 * Unexported, session-scoped Android -> same Node gameplay IPC.
 * The provider runs inside :friend_world; it never opens a second Xbox client.
 * A queued diagnostic command is NOT a server-confirmed gameplay action.
 */
public final class WorldSessionProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }

    @Override public Bundle call(String method, String sessionId, Bundle extras) {
        Bundle result = new Bundle();
        if (!XboxSignInService.started || !XboxSignInService.joining ||
                XboxSignInService.completedMessage != null) return result;
        Path status = XboxSignInService.statusPath;
        String id = status == null ? "" : status.getParent().getFileName().toString();
        if ("stop".equals(method)) {
            if (!id.isEmpty() && id.equals(sessionId)) {
                try {
                    Files.createFile(status.resolveSibling("stop-session"));
                    result.putBoolean("accepted", true);
                } catch (FileAlreadyExistsException alreadyStopping) {
                    result.putBoolean("accepted", true);
                } catch (IOException ignored) {
                    // The session may have closed while the request was in flight.
                }
            }
            return result;
        }

        if ("gameplay".equals(method)) {
            if (!id.isEmpty() && id.equals(sessionId) && status != null &&
                    !Files.exists(status.resolveSibling("stop-session"))) {
                queueGameplay(status.getParent(), extras, result);
            }
            return result;
        }
        if (!"status".equals(method)) return result;

        result.putString("session_id", id);
        JSONObject snapshot = XboxSignInService.readStatus();
        String phase = snapshot == null ? "" : snapshot.optString("phase");
        if (status != null && Files.exists(status.resolveSibling("stop-session"))) {
            result.putString("phase", "stopping");
        } else if ("spawned".equals(phase)) {
            result.putString("phase", "spawned");
            result.putLong("seconds", snapshot.optLong("seconds"));
            result.putLong("chunks", snapshot.optLong("chunks"));
            JSONObject vitals = snapshot.optJSONObject("vitals");
            if (vitals != null) {
                if (vitals.has("health")) result.putString("health", vitals.optString("health"));
                if (vitals.has("hunger")) result.putString("hunger", vitals.optString("hunger"));
                result.putString("assessment", vitals.optString("assessment"));
            }
            // Only sanitized, bounded numbers escape the child process.
            JSONObject gameplay = snapshot.optJSONObject("gameplay");
            if (gameplay != null) {
                result.putString("gameplay_state", gameplay.optString("state", ""));
                result.putString("movement", gameplay.optString("movement", "unavailable"));
                JSONObject position = gameplay.optJSONObject("position");
                if (position != null) {
                    result.putString("position", position.optString("x") + ", "
                            + position.optString("y") + ", " + position.optString("z"));
                }
                result.putInt("nearby_players", gameplay.optInt("visiblePlayers", 0));
                result.putInt("corrections", gameplay.optInt("correctionCount", 0));
                JSONObject layer = gameplay.optJSONObject("layerOne");
                if (layer != null) {
                    JSONObject task = layer.optJSONObject("task");
                    if (task != null) {
                        result.putString("gameplay_task", task.optString("type"));
                        result.putString("gameplay_task_state", task.optString("state"));
                        result.putString("gameplay_task_reason", task.optString("reason"));
                    }
                    result.putString("movement_owner", layer.optString("movementOwner", ""));
                    result.putBoolean("safety_hold", layer.optBoolean("safetyHold"));
                    JSONObject inventory = layer.optJSONObject("inventory");
                    if (inventory != null) {
                        result.putBoolean("inventory_known", inventory.optBoolean("known"));
                        result.putInt("inventory_slots", inventory.optInt("slotCount"));
                        result.putInt("inventory_occupied", inventory.optInt("occupiedSlots"));
                    }
                }
                JSONObject command = gameplay.optJSONObject("lastCommand");
                if (command != null) {
                    result.putString("last_command", command.optString("status", "")
                            + ": " + command.optString("reason", ""));
                }
            }
        } else if ("failed".equals(phase) || "stopped".equals(phase) || "disconnected".equals(phase)) {
            result.putString("phase", phase);
        } else {
            result.putString("phase", "connecting");
        }
        return result;
    }

    private static void queueGameplay(Path directory, Bundle extras, Bundle result) {
        if (extras == null) return;
        String action = extras.getString("action", "");
        if (!"status".equals(action) && !"inspect".equals(action) && !"wait".equals(action) &&
                !"stop_movement".equals(action) && !"probe_step".equals(action)) return;
        boolean confirmed = extras.getBoolean("confirmed", false);
        if ("probe_step".equals(action) && !confirmed) return;
        String requestId = UUID.randomUUID().toString();
        Path inbox = directory.resolve("gameplay-command.json");
        Path temporary = directory.resolve("gameplay-command-" + requestId + ".tmp");
        try {
            if (Files.exists(inbox)) return; // Single pending command, no silent overwrite.
            JSONObject command = new JSONObject()
                    .put("version", "minepilot.gameplay.v1")
                    .put("requestId", requestId)
                    .put("action", action);
            if ("probe_step".equals(action)) {
                command.put("confirmed", true).put("direction", "forward");
            }
            Files.write(temporary, command.toString().getBytes(StandardCharsets.UTF_8),
                    StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
            Files.move(temporary, inbox, StandardCopyOption.ATOMIC_MOVE);
            result.putString("request_id", requestId);
            result.putBoolean("accepted", true);
        } catch (Exception ignored) {
            // Command is rejected or the session already ended. Never send account data.
        } finally {
            try { Files.deleteIfExists(temporary); } catch (IOException ignored) {}
        }
    }

    @Override public String getType(Uri uri) { return null; }
    @Override public Cursor query(Uri u, String[] p, String s, String[] a, String o) { throw new UnsupportedOperationException(); }
    @Override public Uri insert(Uri u, ContentValues v) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri u, String s, String[] a) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri u, ContentValues v, String s, String[] a) { throw new UnsupportedOperationException(); }
}
