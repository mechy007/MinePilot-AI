package ai.minepilot.app;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;
import android.widget.TextView;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;

/** Runs one credential-free Node startup test in a dedicated debug process. */
public final class NodeSmokeActivity extends Activity {
    private static final String TAG = "MinePilotNodeSmoke";
    private static final CompletableFuture<String> result = new CompletableFuture<>();
    private static boolean started;

    private static native int runNode(String source);

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        TextView status = new TextView(this);
        status.setTextSize(18);
        status.setPadding(24, 24, 24, 24);
        status.setText("Checking Node.js 24 startup, P-256 crypto, and UDP loopback…");
        setContentView(status);

        result.thenAccept(message -> runOnUiThread(() -> {
            if (!isDestroyed()) status.setText(message);
        }));
        if (!started) {
            started = true;
            new Thread(this::runSmoke, "minepilot-node-smoke").start();
        }
    }

    private void runSmoke() {
        String message;
        try (InputStream input = getAssets().open("node-smoke.cjs")) {
            ByteArrayOutputStream source = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            for (int length; (length = input.read(chunk)) != -1;) {
                source.write(chunk, 0, length);
            }
            System.loadLibrary("minepilot_node_smoke");
            int exitCode = runNode(new String(source.toByteArray(), StandardCharsets.UTF_8));
            message = exitCode == 0
                    ? "PASS. Node.js 24, P-256 crypto, and UDP loopback are available."
                    : "FAIL. Node.js smoke test exited with code " + exitCode + ".";
        } catch (IOException | UnsatisfiedLinkError | SecurityException error) {
            Log.e(TAG, "Runtime initialization failed", error);
            message = "FAIL. The embedded Node.js runtime could not start.";
        }
        Log.i(TAG, message);
        result.complete(message);
    }
}
