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
        AtomicFile file = resultFile(context);
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
