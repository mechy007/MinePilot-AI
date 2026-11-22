package ai.minepilot.app;

import android.content.Context;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Shares the latest display-safe sign-in result between the runtime and dashboard. */
final class XboxSignInReceiver {
    private static AtomicFile resultFile(Context context) {
        return new AtomicFile(new File(context.getNoBackupFilesDir(), "xbox-sign-in-result"));
    }

    static void record(Context context, String message) {
        write(resultFile(context), message);
    }

    private static AtomicFile friendsFile(Context context) {
        return new AtomicFile(new File(context.getNoBackupFilesDir(), "xbox-friends"));
    }

    static void recordFriends(Context context, org.json.JSONObject snapshot) {
        write(friendsFile(context), snapshot.toString());
    }

    static void clearFriends(Context context) { friendsFile(context).delete(); }

    static org.json.JSONObject latestFriends(Context context) {
        try {
            org.json.JSONObject result = new org.json.JSONObject(new String(
                    friendsFile(context).readFully(), StandardCharsets.UTF_8));
            return BotAccount.xuid(context).equals(result.getString("owner")) ? result : null;
        } catch (IOException | org.json.JSONException unavailable) {
            return null;
        }
    }

    private static void write(AtomicFile file, String message) {
        FileOutputStream output = null;
        try {
            output = file.startWrite();
            output.write(message.getBytes(StandardCharsets.UTF_8));
            file.finishWrite(output);
        } catch (IOException failure) {
            if (output != null) file.failWrite(output);
        }
    }

    static String latest(Context context) {
        try {
            return new String(resultFile(context).readFully(), StandardCharsets.UTF_8);
        } catch (IOException unavailable) {
            return "";
        }
    }
}
