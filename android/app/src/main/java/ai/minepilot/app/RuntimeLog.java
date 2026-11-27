package ai.minepilot.app;

import android.content.Context;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayDeque;
import org.json.JSONException;
import org.json.JSONObject;

/** Recent, app-owned diagnostic events shared with the friend-world process. */
final class RuntimeLog {
    private static final int MAX_EVENTS = 300;
    private static final int ROTATE_AT_BYTES = 4 * 1024 * 1024;

    static Path file(Context context) {
        return context.getNoBackupFilesDir().toPath().resolve("runtime-events.jsonl");
    }

    static void begin(Context context, String phase) {
        Path file = file(context);
        try {
            if (Files.exists(file) && Files.size(file) >= ROTATE_AT_BYTES) {
                Path previous = file.resolveSibling("runtime-events.previous.jsonl");
                Files.move(file, previous, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException ignored) {
            // Keep running if the phone cannot rotate the log.
        }
        record(context, phase);
    }

    static void record(Context context, String phase) {
        record(context, phase, null);
    }

    static void record(Context context, String phase, JSONObject details) {
        try {
            JSONObject event = new JSONObject().put("at", System.currentTimeMillis()).put("phase", phase);
            if (details != null) event.put("details", details);
            Files.write(file(context), (event + "\n").getBytes(StandardCharsets.UTF_8),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException | JSONException ignored) {
            // Log storage is optional to the runtime.
        }
    }

    static ArrayDeque<JSONObject> recent(Context context) {
        Path current = file(context);
        ArrayDeque<JSONObject> events = new ArrayDeque<>(MAX_EVENTS);
        read(current.resolveSibling("runtime-events.previous.jsonl"), events);
        read(current, events);
        return events;
    }

    private static void read(Path file, ArrayDeque<JSONObject> events) {
        try (var lines = Files.newBufferedReader(file)) {
            for (String line; (line = lines.readLine()) != null;) {
                try {
                    JSONObject event = new JSONObject(line);
                    if (events.size() == MAX_EVENTS) events.removeFirst();
                    events.addLast(event);
                } catch (JSONException ignored) {
                    // A reader can see an incomplete last line while it is appended.
                }
            }
        } catch (IOException ignored) {
            // A new installation may have no history yet.
        }
    }

    static String describe(JSONObject event) {
        String step = switch (event.optString("step")) {
            case "offer_sent" -> "NetherNet connection offer sent";
            case "answer_received" -> "NetherNet answer received from host";
            case "peer_connected" -> "NetherNet peer connected";
            default -> "";
        };
        if (!step.isEmpty()) return step;
        String stage = switch (event.optString("stage")) {
            case "microsoft_token" -> "Microsoft token exchange";
            case "xbox_token" -> "Xbox session token";
            case "xbox_profile" -> "Xbox profile lookup";
            case "account_save" -> "Saving the Xbox account";
            case "bedrock_credentials" -> "Minecraft credentials";
            case "friends" -> "Xbox friends refresh";
            case "owner" -> "Friend lookup";
            case "discovery" -> "Friend-world discovery";
            case "xbox_membership" -> "Xbox world membership";
            case "world_transport" -> "Reading world transport details";
            case "world_nonce" -> "Waiting for the host’s Minecraft login nonce";
            case "nethernet_signalling" -> "Minecraft signalling";
            case "nethernet_peer" -> "NetherNet peer negotiation";
            case "bedrock_login" -> "Minecraft login";
            case "bedrock_spawn" -> "Waiting for Minecraft spawn";
            case "runtime" -> "Android runtime";
            default -> "";
        };
        String message = switch (event.optString("phase")) {
            case "join_start" -> "Starting friend-world join";
            case "sign_in_start" -> "Starting Xbox sign-in";
            case "friends_start" -> "Refreshing Xbox friends";
            case "runtime_ready" -> "Android runtime ready";
            case "runtime_failed" -> "Android runtime failed";
            case "runtime_interrupted" -> "Android runtime interrupted";
            case "manual_input_sent" -> "Android manual input dispatched";
            case "manual_input_accepted" -> "Runtime accepted manual input";
            case "manual_input_rejected" -> "Runtime rejected manual input";
            case "manual_input_released" -> "Android manual input released";
            case "app_command_sent" -> "Android gameplay command dispatched";
            case "app_command_accepted" -> "Runtime accepted gameplay command";
            case "app_command_rejected" -> "Runtime rejected gameplay command";
            case "device_code" -> "Waiting for Microsoft approval";
            case "microsoft_approved" -> "Microsoft approval received";
            case "bedrock_credentials" -> "Verifying Minecraft credentials";
            case "verified" -> "Xbox and Minecraft credentials verified";
            case "account_sent" -> "Xbox identity sent to Android";
            case "account_saved" -> "Xbox account saved";
            case "account_failed" -> "Xbox account could not be saved";
            case "friends_loaded" -> "Xbox friends loaded";
            case "discovery" -> "Looking up your friend’s world";
            case "connection" -> stage.isEmpty() ? "Friend’s world found" : stage;
            case "retrying" -> "Retrying the friend-world join";
            case "spawned" -> "Bot spawned in Minecraft";
            case "disconnected" -> "Friend-world session disconnected";
            case "stopped" -> "Connection stopped";
            case "failed" -> stage.isEmpty() ? "Connection failed" : "Failed during " + stage;
            default -> "Runtime event";
        };
        String reason = switch (event.optString("reason")) {
            case "no_transport" -> "No compatible transport advertised";
            case "transport" -> "Transport error";
            case "network" -> "Network error";
            case "timeout" -> "Timed out";
            case "host_disconnect" -> "Host disconnected the bot";
            case "nethernet_closed" -> "NetherNet connection closed";
            case "nonce_unavailable" -> "Host login nonce unavailable";
            default -> "";
        };
        if (!reason.isEmpty()) message += " · " + reason;
        JSONObject details = event.optJSONObject("details");
        if (details != null) {
            String mode = details.optString("mode", "");
            if (!mode.isEmpty()) message += "\nInput mode: " + mode;
            if (details.has("motionX") || details.has("motionY"))
                message += "\nAnalog vector: x=" + details.optDouble("motionX") +
                        " y=" + details.optDouble("motionY");
            if (details.has("jump")) message += "\nActions: jump=" + details.optBoolean("jump") +
                    " sprint=" + details.optBoolean("sprint") +
                    " sneak=" + details.optBoolean("sneak");
            String commandStatus = details.optString("status", "");
            if (!commandStatus.isEmpty()) message += "\nCommand result: " + commandStatus +
                    (details.optString("reason").isEmpty() ? "" : " · " + details.optString("reason"));
        }
        int http = event.optInt("httpStatus");
        if (http >= 400 && http <= 599) message += " · HTTP " + http;
        int nethernet = event.optInt("nethernetCode");
        if (nethernet > 0 && nethernet <= 255) message += " · NetherNet " + nethernet;
        String bedrock = bedrockDisconnect(event.optInt("bedrockCode", -1));
        if (!bedrock.isEmpty()) message += " · " + bedrock;
        String xbox = event.optString("xboxCode");
        if (xbox.matches("214[0-9]{7}")) message += " · Xbox " + xbox;

        JSONObject gameplay = event.optJSONObject("gameplay");
        if (gameplay != null) {
            JSONObject packets = gameplay.optJSONObject("packetTelemetry");
            if (packets != null) {
                message += "\nBedrock packets received: " + packets.optLong("received") +
                        " · sent: " + packets.optLong("sent") +
                        " · inbound handler errors: " + packets.optLong("errors") +
                        " · outbound send errors: " + packets.optLong("sentErrors");
                JSONObject byType = packets.optJSONObject("byType");
                if (byType != null && byType.length() > 0) {
                    java.util.ArrayList<String> counts = new java.util.ArrayList<>();
                    var keys = byType.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        counts.add(key + "=" + byType.optLong(key));
                    }
                    java.util.Collections.sort(counts);
                    message += "\nInbound packet types: " + String.join(", ", counts);
                }
                JSONObject sentByType = packets.optJSONObject("sentByType");
                if (sentByType != null && sentByType.length() > 0) {
                    java.util.ArrayList<String> counts = new java.util.ArrayList<>();
                    var keys = sentByType.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        counts.add(key + "=" + sentByType.optLong(key));
                    }
                    java.util.Collections.sort(counts);
                    message += "\nOutbound packet types: " + String.join(", ", counts);
                }
                String lastType = packets.optString("lastType", "");
                if (!lastType.isEmpty()) message += "\nLast inbound packet: " + lastType +
                        " · " + packets.optJSONObject("lastSummary");
                String lastSentType = packets.optString("lastSentType", "");
                if (!lastSentType.isEmpty()) message += "\nLast outbound packet: " + lastSentType +
                        " · " + packets.optJSONObject("lastSentSummary");
                JSONObject packetError = packets.optJSONObject("lastError");
                if (packetError != null) message += "\nLast packet-handler error: " +
                        packetError.optString("event") + " · " + packetError.optString("name");
            }
            JSONObject commands = gameplay.optJSONObject("commandTelemetry");
            if (commands != null) {
                message += "\nApp commands received by runtime: " + commands.optLong("received");
                JSONObject byAction = commands.optJSONObject("byAction");
                if (byAction != null && byAction.length() > 0) {
                    java.util.ArrayList<String> counts = new java.util.ArrayList<>();
                    var keys = byAction.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        counts.add(key + "=" + byAction.optLong(key));
                    }
                    java.util.Collections.sort(counts);
                    message += "\nCommand actions: " + String.join(", ", counts);
                }
                JSONObject last = commands.optJSONObject("last");
                if (last != null) message += "\nLast command: " + last.optString("action") +
                        " → " + last.optString("status") +
                        (last.optString("reason").isEmpty() ? "" : " · " + last.optString("reason")) +
                        " · " + last.optLong("durationMs") + " ms";
            }
            JSONObject movement = gameplay.optJSONObject("movementSystem");
            if (movement != null) {
                message += "\nMovement engine: " + movement.optString("state", "unknown") +
                        " · capability " + movement.optString("capability", "unknown") +
                        " · frames sent " + movement.optLong("framesSent") +
                        " · corrections " + movement.optLong("corrections") +
                        " · non-neutral frames " + movement.optLong("nonNeutralFrames");
                JSONObject lastResult = movement.optJSONObject("lastMovementResult");
                if (lastResult != null) message += "\nMovement result: " +
                        lastResult.optString("status") + " · " + lastResult.optString("reason");
                JSONObject lastInput = movement.optJSONObject("lastInput");
                if (lastInput != null) message += "\nLast movement input: " + lastInput;
                JSONObject lastError = movement.optJSONObject("lastError");
                if (lastError != null) message += "\nMovement error: " + lastError;
            }
            message += "\nFull sanitized session telemetry:\n" + gameplay.toString();
        }
        return message;
    }

    static boolean hasFailure(JSONObject event) {
        String phase = event.optString("phase");
        if (java.util.Arrays.asList("failed", "runtime_failed", "account_failed", "disconnected",
                "runtime_interrupted", "manual_input_rejected", "app_command_rejected").contains(phase)) return true;
        if (event.optInt("httpStatus") >= 400 || event.optInt("nethernetCode") > 0 ||
                event.optInt("bedrockCode", -1) >= 0 || event.has("error")) return true;
        JSONObject details = event.optJSONObject("details");
        if (details != null && java.util.Arrays.asList("rejected", "failed", "blocked")
                .contains(details.optString("status"))) return true;
        JSONObject gameplay = event.optJSONObject("gameplay");
        if (gameplay == null) return false;
        JSONObject packets = gameplay.optJSONObject("packetTelemetry");
        if (packets != null && (packets.optInt("errors") > 0 || packets.optInt("sentErrors") > 0)) return true;
        JSONObject commands = gameplay.optJSONObject("commandTelemetry");
        JSONObject lastCommand = commands == null ? null : commands.optJSONObject("last");
        if (lastCommand != null && java.util.Arrays.asList("rejected", "failed", "blocked")
                .contains(lastCommand.optString("status"))) return true;
        JSONObject movement = gameplay.optJSONObject("movementSystem");
        return movement != null && movement.optJSONObject("lastError") != null;
    }

    static String bedrockDisconnect(int code) {
        if (code < 0 || code > 255) return "";
        String reason = switch (code) {
            case 2, 45, 111 -> "Access denied";
            case 8, 34, 35, 73 -> "Minecraft version mismatch";
            case 25 -> "World full";
            case 43 -> "Account logged in elsewhere";
            case 46, 146 -> "Minecraft authentication rejected";
            case 136 -> "Login nonce missing";
            case 137 -> "Login nonce unknown to the host";
            case 138 -> "Login nonce expired";
            case 139 -> "Login nonce invalid";
            case 144 -> "Minecraft login token expired";
            default -> "";
        };
        return reason.isEmpty() ? "Bedrock code " + code : reason + " (Bedrock code " + code + ")";
    }
}
