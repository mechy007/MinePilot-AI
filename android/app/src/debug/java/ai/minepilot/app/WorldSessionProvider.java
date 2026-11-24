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
                result.putString("movement_authority_source", gameplay.optString("movementAuthoritySource", "unknown"));
                result.putString("player_gamemode", gameplay.optString("playerGameMode", "unknown"));
                result.putString("world_gamemode", gameplay.optString("worldGameMode", "unknown"));
                result.putString("effective_gamemode", gameplay.optString("serverGameMode", "unknown"));
                if (!gameplay.isNull("difficulty"))
                    result.putInt("world_difficulty", gameplay.optInt("difficulty", -1));
                if (!gameplay.isNull("movementAuthority"))
                    result.putString("movement_authority", gameplay.optString("movementAuthority", ""));
                // Explicitly bounded, sanitized life telemetry from the authenticated
                // Bedrock client. No raw identity, chat, token or arbitrary JSON.
                JSONObject life = gameplay.optJSONObject("life");
                JSONObject botPosition = gameplay.optJSONObject("position");
                if (life != null) {
                    result.putBoolean("life_available", true);
                    String state = life.optString("state", "awaiting_world");
                    String intent = life.optString("intent", "observe");
                    if (state.matches("[a-z_]{1,36}")) result.putString("life_state", state);
                    if (intent.matches("[a-z_]{1,36}")) result.putString("life_intent", intent);
                    for (String key : new String[]{"health","hunger"}) {
                        Object value = life.opt(key);
                        if (value instanceof Number && Double.isFinite(((Number)value).doubleValue())) {
                            int count = ((Number)value).intValue();
                            if (count >= 0 && count <= 20)
                                result.putInt("life_" + key, count);
                        }
                    }
                    result.putInt("life_hostiles", Math.max(0, Math.min(24,
                            life.optInt("hostilesNearby", 0))));
                    JSONObject terrain = life.optJSONObject("localTerrain");
                    if (terrain != null) {
                        for (String key : new String[]{"walkable","hazard","blocked","unknown"})
                            result.putInt("life_" + key, Math.max(0, Math.min(25, terrain.optInt(key, 0))));
                    }
                    org.json.JSONArray nearby = life.optJSONArray("nearbyEntities");
                    if (nearby != null && botPosition != null) {
                        double bx = botPosition.optDouble("x", Double.NaN);
                        double bz = botPosition.optDouble("z", Double.NaN);
                        if (Double.isFinite(bx) && Double.isFinite(bz)) {
                            float[] vectors = new float[Math.min(24, nearby.length()) * 4];
                            int n = 0;
                            for (int i = 0; i < Math.min(24, nearby.length()); i++) {
                                JSONObject entity = nearby.optJSONObject(i);
                                if (entity == null) continue;
                                JSONObject pos = entity.optJSONObject("position");
                                if (pos == null) continue;
                                double dx = pos.optDouble("x", Double.NaN) - bx;
                                double dz = pos.optDouble("z", Double.NaN) - bz;
                                if (!Double.isFinite(dx) || !Double.isFinite(dz) ||
                                        Math.hypot(dx,dz) > 24) continue;
                                vectors[n++] = (float)dx;
                                vectors[n++] = (float)dz;
                                vectors[n++] = entity.optBoolean("hostile", false) ? 1f : 0f;
                                vectors[n++] = "player".equals(entity.optString("kind")) ? 1f : 0f;
                            }
                            result.putFloatArray("life_entity_vectors",
                                    java.util.Arrays.copyOf(vectors, n));
                        }
                    }
                }
                JSONObject agent = gameplay.optJSONObject("gameplayAgent");
                if (agent != null) {
                    result.putBoolean("agent_active", agent.optBoolean("active",false));
                    for(String key : new String[]{"goal","phase","reason","execution"}) {
                        String value=agent.optString(key,"");
                        if (value.matches("[a-z_]{1,72}"))
                            result.putString("agent_" + key,value);
                    }
                    result.putInt("agent_attempted",Math.max(0,
                            Math.min(40,agent.optInt("attemptedSteps",0))));
                    result.putInt("agent_verified",Math.max(0,
                            Math.min(40,agent.optInt("serverVerifiedSteps",0))));
                    result.putInt("agent_failures",Math.max(0,
                            Math.min(2,agent.optInt("failures",0))));
                    result.putInt("agent_collected",Math.max(0,
                            Math.min(64,agent.optInt("collectedDrops",0))));
                }
                JSONObject capabilities=gameplay.optJSONObject("gameplaySkills");
                if(capabilities!=null) {
                    org.json.JSONArray known=capabilities.optJSONArray("skills");
                    int usable=0,preview=0,unsupported=0;
                    if(known!=null){
                        for(int i=0;i<Math.min(24,known.length());i++){
                            JSONObject skill=known.optJSONObject(i);
                            if(skill==null)continue;
                            String state=skill.optString("state","");
                            if("ready".equals(state)||"experimental".equals(state))
                                usable++;
                            else if("preview_only".equals(state)||"manual_experimental".equals(state)||
                                    "protocol_only".equals(state)||"partial".equals(state))
                                preview++;
                            else if("unsupported".equals(state))unsupported++;
                        }
                    }
                    result.putInt("gameplay_skill_ready",usable);
                    result.putInt("gameplay_skill_limited",preview);
                    result.putInt("gameplay_skill_unsupported",unsupported);
                    JSONObject learning = capabilities.optJSONObject("learning");
                    if (learning != null) {
                        result.putString("learning_version", learning.optString("version", ""));
                        result.putInt("learning_learned", Math.max(0, Math.min(128, learning.optInt("learnedSkillCount", 0))));
                        result.putInt("learning_proposed", Math.max(0, Math.min(64, learning.optInt("proposedSkillCount", 0))));
                        result.putInt("learning_verified_total", Math.max(0, Math.min(10000000, learning.optInt("totalVerifiedNavigationSteps", 0))));
                        JSONObject odyssey = capabilities.optJSONObject("odysseyLibrary");
                        if (odyssey != null) {
                            result.putInt("odyssey_total", Math.max(0, Math.min(183, odyssey.optInt("total", 0))));
                            result.putInt("odyssey_ready", Math.max(0, Math.min(183, odyssey.optInt("ready", 0))));
                            result.putInt("odyssey_partial", Math.max(0, Math.min(183, odyssey.optInt("partial", 0))));
                            result.putInt("odyssey_manual", Math.max(0, Math.min(183, odyssey.optInt("manual", 0))));
                            result.putInt("odyssey_blocked", Math.max(0, Math.min(183, odyssey.optInt("blocked", 0))));
                        }
                        result.putInt("learning_legacy_records", Math.max(0, Math.min(128, learning.optInt("legacyVoyagerRecordCountMigrated", 0))));
                        JSONObject localAutopilot = learning.optJSONObject("localAutopilot");
                        if (localAutopilot != null) {
                            result.putBoolean("learning_autopilot_enabled", localAutopilot.optBoolean("enabled", false));
                            String autopilotReason = localAutopilot.optString("reason", "disabled");
                            if (autopilotReason.matches("[a-z_]{1,64}")) result.putString("learning_autopilot_reason", autopilotReason);
                        }
                        JSONObject next = learning.optJSONObject("nextCurriculumTask");
                        if (next != null) {
                            String taskId = next.optString("id", "");
                            String goal = next.optString("goal", "");
                            String title = next.optString("title", "");
                            if (taskId.matches("[a-z][a-z0-9_]{2,47}")) result.putString("learning_next_task_id", taskId);
                            if (goal.matches("[a-z_]{1,32}")) result.putString("learning_next_task_goal", goal);
                            if (title.length() <= 100) result.putString("learning_next_task_title", title);
                        }
                        JSONObject activeTask = learning.optJSONObject("activeTask");
                        if (activeTask != null) {
                            result.putBoolean("learning_active", activeTask.optBoolean("active", false));
                            String taskId = activeTask.optString("id", "");
                            String goal = activeTask.optString("goal", "");
                            String taskPhase = activeTask.optString("phase", "");
                            String reason = activeTask.optString("reason", "");
                            String title = activeTask.optString("title", "");
                            if (taskId.matches("[a-z][a-z0-9_]{2,47}")) result.putString("learning_active_task_id", taskId);
                            if (goal.matches("[a-z_]{1,32}")) result.putString("learning_active_goal", goal);
                            if (taskPhase.matches("[a-z_]{1,32}")) result.putString("learning_active_phase", taskPhase);
                            if (reason.matches("[a-z_]{1,72}")) result.putString("learning_active_reason", reason);
                            if (title.length() <= 100) result.putString("learning_active_title", title);
                            result.putInt("learning_active_verified", Math.max(0, Math.min(40, activeTask.optInt("verifiedSteps", 0))));
                        } else {
                            result.putBoolean("learning_active", false);
                        }
                        org.json.JSONArray recent = learning.optJSONArray("recentRuns");
                        if (recent != null && recent.length() > 0) {
                            JSONObject last = recent.optJSONObject(recent.length() - 1);
                            if (last != null) {
                                String outcome = last.optString("outcome", "");
                                String reason = last.optString("reason", "");
                                String taskId = last.optString("taskId", "");
                                if (outcome.matches("[a-z_]{1,24}")) result.putString("learning_last_outcome", outcome);
                                if (reason.matches("[a-z_]{1,80}")) result.putString("learning_last_reason", reason);
                                if (taskId.matches("[a-z][a-z0-9_]{2,47}")) result.putString("learning_last_task_id", taskId);
                            }
                        }
                    }
                }
                JSONObject intelligence = gameplay.optJSONObject("intelligence");
                if (intelligence != null) {
                    result.putBoolean("brain_available", true);
                    for (String key : new String[]{"goal","action","reason","execution"}) {
                        String value=intelligence.optString(key, "");
                        if (value.matches("[a-z_]{1,48}"))
                            result.putString("brain_" + key, value);
                    }
                    result.putInt("brain_priority", Math.max(0,
                            Math.min(100, intelligence.optInt("priority", 0))));
                    result.putInt("brain_memory_cells", Math.max(0,
                            Math.min(64, intelligence.optInt("memoryCells", 0))));
                    result.putInt("brain_decisions", Math.max(0,
                            intelligence.optInt("decisionCount", 0)));
                    result.putBoolean("brain_world_verified",
                            intelligence.optBoolean("verifiedWorld", false));
                    JSONObject outcomes = intelligence.optJSONObject("outcomes");
                    if (outcomes != null) {
                        result.putInt("brain_verified_steps", Math.max(0,
                                outcomes.optInt("verified", 0)));
                        result.putInt("brain_failed_steps", Math.max(0,
                                outcomes.optInt("failed", 0)));
                    }
                }
                JSONObject firstPerson = gameplay.optJSONObject("firstPerson");
                if (firstPerson != null) {
                    result.putBoolean("fp_available", firstPerson.optBoolean("available", false));
                    String reason = firstPerson.optString("reason", "awaiting_camera");
                    if (reason.matches("[a-z_]{1,40}")) result.putString("fp_reason", reason);
                    if (firstPerson.optBoolean("available", false)) {
                        double yaw = firstPerson.optDouble("yaw", Double.NaN);
                        double pitch = firstPerson.optDouble("pitch", Double.NaN);
                        if (Double.isFinite(yaw) && Double.isFinite(pitch) &&
                                Math.abs(yaw) <= 36000 && Math.abs(pitch) <= 89.9) {
                            result.putFloat("fp_yaw", (float)yaw);
                            result.putFloat("fp_pitch", (float)pitch);
                            org.json.JSONArray cubes = firstPerson.optJSONArray("cubes");
                            if (cubes != null) {
                                float[] output = new float[Math.min(144,cubes.length())*5];
                                int n=0;
                                for(int i=0;i<Math.min(144,cubes.length());i++) {
                                    org.json.JSONArray cube=cubes.optJSONArray(i);
                                    if(cube==null || cube.length()!=5)continue;
                                    double x=cube.optDouble(0,Double.NaN),
                                            y=cube.optDouble(1,Double.NaN),
                                            z=cube.optDouble(2,Double.NaN);
                                    int type=cube.optInt(3,0);
                                    int mask=cube.optInt(4,0);
                                    if(!Double.isFinite(x)||!Double.isFinite(y)||!Double.isFinite(z)||
                                            Math.abs(x)>8||Math.abs(y)>8||Math.abs(z)>8||
                                            type<1||type>8||mask<1||mask>63)continue;
                                    output[n++]=(float)x;output[n++]=(float)y;
                                    output[n++]=(float)z;output[n++]=type;
                                    output[n++]=mask;
                                }
                                result.putFloatArray("fp_blocks",java.util.Arrays.copyOf(output,n));
                            }
                            org.json.JSONArray entities = firstPerson.optJSONArray("entities");
                            if(entities!=null){
                                float[] output=new float[Math.min(16,entities.length())*4];
                                int n=0;
                                for(int i=0;i<Math.min(16,entities.length());i++){
                                    org.json.JSONArray entity=entities.optJSONArray(i);
                                    if(entity==null || entity.length()!=4)continue;
                                    double x=entity.optDouble(0,Double.NaN),
                                            y=entity.optDouble(1,Double.NaN),
                                            z=entity.optDouble(2,Double.NaN);
                                    int type=entity.optInt(3,0);
                                    if(!Double.isFinite(x)||!Double.isFinite(y)||!Double.isFinite(z)||
                                            Math.abs(x)>17||Math.abs(y)>17||Math.abs(z)>17||
                                            type<1||type>3)continue;
                                    output[n++]=(float)x;output[n++]=(float)y;
                                    output[n++]=(float)z;output[n++]=type;
                                }
                                result.putFloatArray("fp_entities",java.util.Arrays.copyOf(output,n));
                            }
                        } else {
                            result.putBoolean("fp_available",false);
                            result.putString("fp_reason","camera_rotation_unobserved");
                        }
                    }
                }
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
                    result.putBoolean("presence_active", diagnostic.optBoolean("presenceActive", false));
                    result.putInt("presence_frames", diagnostic.optInt("presenceFrames", 0));
                    result.putString("presence_error", diagnostic.optString("presenceError", ""));
                    result.putInt("motion_server_updates", diagnostic.optInt("serverUpdates", 0));
                    result.putInt("motion_corrections", diagnostic.optInt("corrections", 0));
                    result.putString("motion_displacement", diagnostic.optString("observedDisplacement", ""));
                    result.putString("motion_drift", diagnostic.optString("maxDrift", ""));
                    result.putString("motion_stop_reason", diagnostic.optString("stoppedReason", ""));
                    String motionModel=diagnostic.optString("motionModel","");
                    if(motionModel.matches("[a-z_]{1,40}"))
                        result.putString("motion_model",motionModel);
                    JSONObject inputClock=diagnostic.optJSONObject("inputClock");
                    if(inputClock!=null&&inputClock.optInt("protocol",-1)==2225) {
                        result.putInt("input_skipped_ticks",Math.max(0,
                                inputClock.optInt("skippedTicks",0)));
                        result.putInt("input_correction_anchors",Math.max(0,
                                inputClock.optInt("observedCorrections",0)));
                        result.putInt("input_rejected_anchors",Math.max(0,
                                inputClock.optInt("rejectedCorrections",0)));
                        String tick=inputClock.optString("lastTick","");
                        if(tick.matches("[0-9]{1,20}"))result.putString("input_last_tick",tick);
                    }
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
                JSONObject terrain = gameplay.optJSONObject("terrain");
                if (terrain != null) {
                    result.putInt("terrain_sections", terrain.optInt("decodedSections", 0));
                    result.putInt("terrain_decode_errors", terrain.optInt("decodeErrors", 0));
                    result.putBoolean("terrain_registry_ready", terrain.optBoolean("collisionClassificationReady", false));
                }
                JSONObject route = gameplay.optJSONObject("navigationRoute");
                if (route != null) {
                    result.putString("terrain_route_status", route.optString("status", ""));
                    result.putString("terrain_route_reason", route.optString("reason", ""));
                    result.putInt("terrain_route_length", route.optJSONArray("path") == null
                        ? 0 : route.optJSONArray("path").length());
                }
                JSONObject breaker = gameplay.optJSONObject("blockBreak");
                if(breaker!=null) {
                    result.putString("block_break_status", breaker.optString("status", "idle"));
                    result.putString("block_break_reason", breaker.optString("reason", ""));
                    result.putInt("block_break_frames", breaker.optInt("frames", 0));
                    result.putBoolean("block_break_changed", breaker.optBoolean("serverChanged", false));
                }
                JSONObject autonomy = gameplay.optJSONObject("autonomy");
                if (autonomy != null) {
                    result.putBoolean("autonomy_active", autonomy.optBoolean("active", false));
                    result.putString("autonomy_phase", autonomy.optString("phase", "idle"));
                    result.putString("autonomy_reason", autonomy.optString("stopReason", ""));
                    result.putInt("autonomy_attempted", autonomy.optInt("attemptedSteps", 0));
                    result.putInt("autonomy_verified", autonomy.optInt("serverVerifiedSteps", 0));
                }
                JSONObject navigator = gameplay.optJSONObject("addonNavigation");
                if (navigator != null) {
                    result.putString("addon_nav_owner", navigator.optString("owner", "none"));
                    result.putString("addon_nav_state", navigator.optString("state", "idle"));
                    result.putString("addon_nav_reason", navigator.optString("reason", ""));
                    result.putInt("addon_nav_stuck", navigator.optInt("stuckSamples", 0));
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
                    String primitive = command.optString("primitive", "");
                    if (primitive.matches("getLogsCount|getPlanksCount|checkBlockAbove|checkBlocksAround|findSuitablePosition")) {
                        result.putString("last_command_primitive", primitive);
                        Object observed = command.opt("result");
                        String observedText = observed == null ? "" : observed.toString();
                        if (observedText.length() > 2048) observedText = observedText.substring(0, 2048);
                        result.putString("last_command_result", observedText);
                        result.putBoolean("last_command_read_only", command.optBoolean("readOnly", false));
                    }
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
                !"motion_diagnostic".equals(action) && !"verified_step".equals(action) &&
                !"autonomy_follow".equals(action) && !"follow_player".equals(action) && !"autonomy_stop".equals(action) &&
                !"agent_start".equals(action) && !"agent_stop".equals(action) &&
                !"experimental_break".equals(action) && !"learning_start".equals(action) &&
                !"learning_stop".equals(action) && !"learning_propose".equals(action) &&
                !"learning_autopilot_start".equals(action) && !"learning_autopilot_stop".equals(action) &&
                !"odyssey_observe".equals(action) && !"odyssey_execute".equals(action)) return;
        boolean confirmed = extras.getBoolean("confirmed", false);
        if (("probe_step".equals(action) || "motion_diagnostic".equals(action) ||
                "verified_step".equals(action) || "autonomy_follow".equals(action) || "follow_player".equals(action) ||
                "agent_start".equals(action) || "learning_start".equals(action) ||
                "learning_propose".equals(action) || "learning_autopilot_start".equals(action) ||
                "odyssey_observe".equals(action) || "odyssey_execute".equals(action) || "experimental_break".equals(action)) && !confirmed) return;
        String requestId = UUID.randomUUID().toString();
        Path inbox = directory.resolve("gameplay-command.json");
        Path temporary = directory.resolve("gameplay-command-" + requestId + ".tmp");
        try {
            if (Files.exists(inbox)) return; // Single pending command, no silent overwrite.
            JSONObject command = new JSONObject()
                    .put("version", "minepilot.gameplay.v1")
                    .put("requestId", requestId)
                    .put("action", action);
            if ("plan_follow".equals(action) || "follow_player".equals(action)) {
                String name = extras.getString("player_name", "");
                if (!name.matches("[a-zA-Z0-9_ #.\\-]{1,32}")) return;
                command.put("playerName", name);
            }
            if ("learning_start".equals(action)) {
                String taskId = extras.getString("task_id", "");
                if (!taskId.matches("[a-z][a-z0-9_]{2,47}")) return;
                command.put("taskId", taskId).put("confirmed", true);
            }
            if ("odyssey_observe".equals(action)) {
                String primitive = extras.getString("primitive", "");
                if (!"getLogsCount".equals(primitive) && !"getPlanksCount".equals(primitive) &&
                        !"checkBlockAbove".equals(primitive) && !"checkBlocksAround".equals(primitive) &&
                        !"findSuitablePosition".equals(primitive)) return;
                JSONObject args = new JSONObject();
                String source = extras.getString("block_position", "").trim();
                if (!source.isEmpty()) {
                    String[] coordinates = source.split(",", -1);
                    if (coordinates.length != 3) return;
                    int bx, by, bz;
                    try {
                        bx = Integer.parseInt(coordinates[0].trim());
                        by = Integer.parseInt(coordinates[1].trim());
                        bz = Integer.parseInt(coordinates[2].trim());
                    } catch (NumberFormatException invalid) { return; }
                    if (Math.abs((long) bx) > 30000000 || Math.abs((long) bz) > 30000000 ||
                            by < -256 || by > 512) return;
                    args.put("position", new JSONObject().put("x", bx).put("y", by).put("z", bz));
                } else if ("checkBlockAbove".equals(primitive)) {
                    return; // This primitive needs an explicit block coordinate.
                }
                command.put("primitive", primitive).put("args", args).put("confirmed", true);
            }
            if ("odyssey_execute".equals(action)) {
                String primitive = extras.getString("primitive", "");
                JSONObject args = new JSONObject();
                if ("goto".equals(primitive)) {
                    String source = extras.getString("target_position", "").trim();
                    String[] coordinates = source.split(",", -1);
                    if (coordinates.length != 3) return;
                    double x, y, z;
                    try {
                        x = Double.parseDouble(coordinates[0].trim());
                        y = Double.parseDouble(coordinates[1].trim());
                        z = Double.parseDouble(coordinates[2].trim());
                    } catch (NumberFormatException invalid) { return; }
                    if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z) ||
                            Math.abs(x) > 30000000 || Math.abs(z) > 30000000 || y < -256 || y > 512) return;
                    args.put("targetPosition", new JSONObject().put("x", x).put("y", y).put("z", z));
                } else if ("mineBlock".equals(primitive)) {
                    String source = extras.getString("block_position", "").trim();
                    String[] coordinates = source.split(",", -1);
                    if (coordinates.length != 3) return;
                    int x, y, z;
                    try {
                        x = Integer.parseInt(coordinates[0].trim());
                        y = Integer.parseInt(coordinates[1].trim());
                        z = Integer.parseInt(coordinates[2].trim());
                    } catch (NumberFormatException invalid) { return; }
                    if (Math.abs((long) x) > 30000000 || Math.abs((long) z) > 30000000 ||
                            y < -256 || y > 512) return;
                    args.put("position", new JSONObject().put("x", x).put("y", y).put("z", z));
                } else if (!"exploreUntil".equals(primitive)) {
                    return;
                }
                command.put("primitive", primitive).put("args", args).put("confirmed", true);
            }
            if ("learning_propose".equals(action)) {
                String skillJson = extras.getString("skill_json", "");
                if (skillJson.length() < 2 || skillJson.length() > 1200) return;
                JSONObject skill = new JSONObject(skillJson);
                command.put("skill", skill).put("confirmed", true);
            }
            if ("agent_start".equals(action)) {
                String goal=extras.getString("agent_goal","");
                if (!"survive".equals(goal) && !"explore".equals(goal) &&
                        !"follow".equals(goal) &&
                        !"return_home".equals(goal) && !"gather".equals(goal)) return;
                command.put("goal",goal);
                if ("follow".equals(goal)) {
                    String name=extras.getString("player_name","");
                    if (!name.isEmpty()) {
                        if (!name.matches("[a-zA-Z0-9_ #.\\\\-]{1,32}")) return;
                        command.put("playerName",name);
                    }
                }
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
            if ("experimental_break".equals(action)) {
                String source = extras.getString("block_position", "").trim();
                String[] coordinates = source.split(",", -1);
                if(coordinates.length!=3)return;
                int bx,by,bz;
                try {
                    bx=Integer.parseInt(coordinates[0].trim());
                    by=Integer.parseInt(coordinates[1].trim());
                    bz=Integer.parseInt(coordinates[2].trim());
                } catch(NumberFormatException invalid){return;}
                if(Math.abs((long)bx)>30000000 || Math.abs((long)bz)>30000000 ||
                    by<-256 || by>512)return;
                command.put("position", new JSONObject().put("x",bx).put("y",by).put("z",bz));
            }
            if ("verified_step".equals(action) || "autonomy_follow".equals(action) ||
                "follow_player".equals(action) || "agent_start".equals(action) ||
                "learning_start".equals(action) || "learning_propose".equals(action) ||
                "learning_autopilot_start".equals(action) || "odyssey_observe".equals(action) ||
                "experimental_break".equals(action))
                command.put("confirmed", true);
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
