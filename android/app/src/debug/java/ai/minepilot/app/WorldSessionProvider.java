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
                result.putString("player_gamemode", gameplay.optString("playerGameMode", "unknown"));
                result.putString("world_gamemode", gameplay.optString("worldGameMode", "unknown"));
                result.putString("effective_gamemode", gameplay.optString("serverGameMode", "unknown"));
                if (!gameplay.isNull("difficulty"))
                    result.putInt("world_difficulty", gameplay.optInt("difficulty", -1));
                if (!gameplay.isNull("movementAuthority"))
                    result.putString("movement_authority", gameplay.optString("movementAuthority", ""));
                JSONObject spawnHandshake = gameplay.optJSONObject("spawnHandshake");
                if (spawnHandshake != null) {
                    result.putBoolean("spawn_loading_completed", spawnHandshake.optBoolean("loadingCompleted", false));
                    result.putInt("spawn_loading_packets", spawnHandshake.optInt("loadingPacketsSent", 0));
                    result.putInt("spawn_respawn_acks", spawnHandshake.optInt("respawnAcknowledged", 0));
                    result.putInt("spawn_handshake_errors", spawnHandshake.optInt("handshakeErrors", 0));
                }
                JSONObject position = gameplay.optJSONObject("position");
                if (position != null) {
                    result.putString("position", position.optString("x") + ", "
                            + position.optString("y") + ", " + position.optString("z"));
                }
                result.putInt("nearby_players", gameplay.optInt("visiblePlayers", 0));
                result.putInt("corrections", gameplay.optInt("correctionCount", 0));
                JSONObject diagnostic = gameplay.optJSONObject("motionDiagnostic");
                if (diagnostic != null) {
                    result.putString("motion_mode", diagnostic.optString("mode", "idle"));
                    result.putBoolean("motion_active", diagnostic.optBoolean("active", false));
                    result.putInt("motion_frames", diagnostic.optInt("framesSent", 0));
                    result.putInt("motion_server_updates", diagnostic.optInt("serverUpdates", 0));
                    result.putInt("motion_corrections", diagnostic.optInt("corrections", 0));
                    result.putString("motion_displacement", diagnostic.optString("observedDisplacement", ""));
                    result.putString("motion_drift", diagnostic.optString("maxDrift", ""));
                    result.putString("motion_stop_reason", diagnostic.optString("stoppedReason", ""));
                }
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
                JSONObject follow = gameplay.optJSONObject("layerTwo");
                if (follow != null) {
                    JSONObject preview = follow.optJSONObject("preview");
                    if (preview != null) {
                        result.putString("follow_goal", preview.optString("goal", ""));
                        result.putString("follow_state", preview.optString("status", ""));
                        result.putString("follow_reason", preview.optString("reason", ""));
                        if (!preview.isNull("distance")) result.putString("follow_distance", preview.optString("distance"));
                        if (!preview.isNull("heading")) result.putString("follow_heading", preview.optString("heading"));
                        result.putString("follow_player", preview.optString("targetName", ""));
                    }
                    result.putBoolean("home_known", follow.optBoolean("homeKnown", false));
                    org.json.JSONArray names = follow.optJSONArray("visiblePlayerNames");
                    if (names != null) {
                        StringBuilder namesPreview = new StringBuilder();
                        for (int i = 0; i < Math.min(names.length(), 8); i++) {
                            String name = names.optString(i, "");
                            if (!name.matches("[a-zA-Z0-9_ #.\\-]{1,32}")) continue;
                            if (namesPreview.length() > 0) namesPreview.append(", ");
                            namesPreview.append(name);
                        }
                        result.putString("visible_player_names", namesPreview.toString());
                    }
                    JSONObject equipment = follow.optJSONObject("equipment");
                    if (equipment != null && equipment.optBoolean("known")) {
                        result.putInt("equipment_slot", equipment.optInt("slot", -1));
                        result.putString("equipment_item_id", equipment.optString("itemId", ""));
                    }
                }
                JSONObject resources = gameplay.optJSONObject("layerThree");
                if (resources != null) {
                    result.putInt("resource_drops", resources.optInt("observedDrops", 0));
                    result.putInt("resource_blocks", resources.optInt("observedBlockUpdates", 0));
                    result.putInt("resource_items", resources.optInt("registeredItems", 0));
                    result.putBoolean("resource_inventory_known", resources.optBoolean("inventoryKnown", false));
                    org.json.JSONArray nearby = resources.optJSONArray("nearbyItemNames");
                    if (nearby != null) {
                        StringBuilder labels = new StringBuilder();
                        for (int i = 0; i < Math.min(nearby.length(), 8); i++) {
                            String name = nearby.optString(i, "");
                            if (!name.matches("minecraft:[a-z0-9_./-]{1,80}")) continue;
                            if (labels.length() > 0) labels.append(", ");
                            labels.append(name);
                        }
                        result.putString("resource_nearby_items", labels.toString());
                    }
                    JSONObject route = resources.optJSONObject("route");
                    if (route != null) {
                        result.putString("resource_state", route.optString("status", ""));
                        result.putString("resource_reason", route.optString("reason", ""));
                        result.putString("resource_target_name", route.optString("itemName", ""));
                        result.putInt("resource_requested", route.optInt("requested", 0));
                        result.putInt("resource_observed", route.optInt("observed", 0));
                        if (!route.isNull("distance")) result.putString("resource_distance", route.optString("distance"));
                        if (!route.isNull("heading")) result.putString("resource_heading", route.optString("heading"));
                    }
                }
                JSONObject survival = gameplay.optJSONObject("layerFour");
                if (survival != null) {
                    result.putString("survival_level", survival.optString("level", "unknown"));
                    result.putString("survival_reason", survival.optString("reason", ""));
                    result.putString("survival_task_status", survival.optString("taskStatus", ""));
                    result.putString("survival_paused_goal", survival.optString("pausedGoal", ""));
                    if (!survival.isNull("isNight")) {
                        result.putString("survival_night", survival.optBoolean("isNight") ? "yes" : "no");
                    }
                    org.json.JSONArray foods = survival.optJSONArray("foodOptions");
                    if (foods != null) {
                        StringBuilder labels = new StringBuilder();
                        for (int i = 0; i < Math.min(foods.length(), 8); i++) {
                            JSONObject food = foods.optJSONObject(i);
                            if (food == null) continue;
                            String name = food.optString("item", "");
                            int count = food.optInt("count");
                            if (!name.matches("minecraft:[a-z0-9_./-]{1,80}") || count < 1) continue;
                            if (labels.length() != 0) labels.append(", ");
                            labels.append(name).append(" x").append(count);
                        }
                        result.putString("survival_foods", labels.toString());
                    }
                    JSONObject plannedFood = survival.optJSONObject("foodPlan");
                    if (plannedFood != null) {
                        String name = plannedFood.optString("item", "");
                        if (name.matches("minecraft:[a-z0-9_./-]{1,80}")) result.putString("survival_food_plan", name);
                    }
                }
                JSONObject construction = gameplay.optJSONObject("layerFive");
                if (construction != null) {
                    result.putString("build_kind", construction.optString("kind", "none"));
                    result.putString("build_state", construction.optString("state", ""));
                    result.putString("build_reason", construction.optString("reason", ""));
                    String material = construction.optString("material", "");
                    if (material.matches("minecraft:[a-z0-9_./-]{1,80}"))
                        result.putString("build_material", material);
                    result.putInt("build_required", construction.optInt("required", 0));
                    result.putInt("build_count", construction.optInt("blockCount", 0));
                    result.putInt("build_observed_updates", construction.optInt("observedNearbyBlockUpdates", 0));
                    if (!construction.isNull("onHand")) result.putInt("build_onhand", construction.optInt("onHand"));
                    if (!construction.isNull("missing")) result.putInt("build_missing", construction.optInt("missing"));
                    if (!construction.isNull("suggestedLogs")) result.putInt("build_logs_needed", construction.optInt("suggestedLogs"));
                    if (!construction.isNull("logsOnHand")) result.putInt("build_logs_onhand", construction.optInt("logsOnHand"));
                }
                JSONObject workflow = gameplay.optJSONObject("layerSix");
                if (workflow != null) {
                    result.putString("workflow_kind", workflow.optString("kind", "none"));
                    result.putString("workflow_state", workflow.optString("state", ""));
                    result.putString("workflow_next", workflow.optString("nextStep", ""));
                    result.putInt("workflow_checkpoint", workflow.optInt("checkpoint", 0));
                    result.putInt("workflow_total", workflow.optInt("totalSteps", 0));
                    result.putInt("workflow_containers", workflow.optInt("containersObserved", 0));
                    result.putInt("workflow_updates", workflow.optInt("recentBlockUpdates", 0));
                    result.putInt("workflow_walkable", workflow.optInt("verifiedWalkableTiles", 0));
                }
                JSONObject advisor = gameplay.optJSONObject("layerSeven");
                if (advisor != null) {
                    result.putString("advisor_mode", advisor.optString("mode", "off"));
                    result.putInt("advisor_journal_count", advisor.optInt("journalSize", 0));
                    JSONObject recommendation = advisor.optJSONObject("recommendation");
                    if (recommendation != null) {
                        result.putString("advisor_action", recommendation.optString("action", "none"));
                        result.putString("advisor_reason", recommendation.optString("reason", ""));
                        result.putString("advisor_state", recommendation.optString("status", ""));
                    }
                }
                JSONObject readiness = gameplay.optJSONObject("layerEight");
                if (readiness != null) {
                    result.putString("beta_stage", readiness.optString("stage", "awaiting_world"));
                    result.putBoolean("beta_ready", readiness.optBoolean("releaseReady", false));
                    result.putBoolean("beta_autonomous", readiness.optBoolean("autonomousGameplayReady", false));
                    result.putBoolean("beta_plan_eligible", readiness.optBoolean("commandEligible", false));
                    result.putString("beta_plan_reason", readiness.optString("commandReason", ""));
                    org.json.JSONArray blockers = readiness.optJSONArray("blockers");
                    if (blockers != null) {
                        StringBuilder reasons = new StringBuilder();
                        for (int i = 0; i < Math.min(4, blockers.length()); i++) {
                            String code = blockers.optString(i, "");
                            if (!code.matches("[a-z_]{1,64}")) continue;
                            if (reasons.length() > 0) reasons.append(", ");
                            reasons.append(code);
                        }
                        result.putString("beta_blockers", reasons.toString());
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
                !"stay".equals(action) && !"set_home".equals(action) &&
                !"plan_follow".equals(action) && !"plan_return".equals(action) &&
                !"plan_collect".equals(action) && !"inspect_block".equals(action) &&
                !"plan_food".equals(action) && !"plan_shelter".equals(action) &&
                !"plan_craft_planks".equals(action) && !"plan_workflow".equals(action) &&
                !"review_checkpoint".equals(action) && !"advisor_mode".equals(action) &&
                !"advisor_review".equals(action) &&
                !"stop_movement".equals(action) && !"probe_step".equals(action) &&
                !"motion_diagnostic".equals(action)) return;
        boolean confirmed = extras.getBoolean("confirmed", false);
        if (("probe_step".equals(action) || "motion_diagnostic".equals(action)) && !confirmed) return;
        String requestId = UUID.randomUUID().toString();
        Path inbox = directory.resolve("gameplay-command.json");
        Path temporary = directory.resolve("gameplay-command-" + requestId + ".tmp");
        try {
            if (Files.exists(inbox)) return; // Single pending command, no silent overwrite.
            JSONObject command = new JSONObject()
                    .put("version", "minepilot.gameplay.v1")
                    .put("requestId", requestId)
                    .put("action", action);
            if ("plan_follow".equals(action)) {
                String name = extras.getString("player_name", "");
                if (!name.matches("[a-zA-Z0-9_ #.\\-]{1,32}")) return;
                command.put("playerName", name);
            }
            if ("plan_collect".equals(action)) {
                String itemName = extras.getString("item_name", "");
                int itemCount = extras.getInt("item_count", -1);
                if (!itemName.matches("minecraft:[a-z0-9_./-]{1,80}") ||
                        itemCount < 1 || itemCount > 64) return;
                command.put("itemName", itemName).put("count", itemCount);
            }
            if ("plan_shelter".equals(action) || "plan_craft_planks".equals(action)) {
                String material = extras.getString("item_name", "");
                if (!material.matches("minecraft:(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|bamboo|crimson|warped|pale_oak)_planks")) return;
                command.put("material", material);
                if ("plan_craft_planks".equals(action)) {
                    int count = extras.getInt("item_count", -1);
                    if (count < 1 || count > 256) return;
                    command.put("count", count);
                }
            }
            if ("plan_workflow".equals(action)) {
                String kind = extras.getString("item_name", "");
                if (!"farm_preview".equals(kind) && !"storage_preview".equals(kind) &&
                        !"collect_preview".equals(kind)) return;
                command.put("workflowKind", kind);
            }
            if ("review_checkpoint".equals(action)) {
                String checkpoint = extras.getString("checkpoint", "");
                if (!"observe".equals(checkpoint) && !"inventory".equals(checkpoint) &&
                        !"terrain".equals(checkpoint) && !"recipe".equals(checkpoint)) return;
                command.put("checkpoint", checkpoint);
            }
            if ("advisor_mode".equals(action)) {
                String mode = extras.getString("item_name", "");
                if (!"suggestions".equals(mode) && !"off".equals(mode)) return;
                command.put("mode", mode);
            }
            if ("motion_diagnostic".equals(action)) {
                String mode = extras.getString("motion_mode", "");
                int ticks = extras.getInt("motion_ticks", -1);
                if (!"forward".equals(mode) && !"turn_left".equals(mode) &&
                    !"turn_right".equals(mode)) return;
                if (ticks < 1 || ticks > 20) return;
                command.put("confirmed", true).put("mode", mode).put("ticks", ticks);
            }
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
