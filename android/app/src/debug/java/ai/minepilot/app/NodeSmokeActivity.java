package ai.minepilot.app;

import android.app.Activity;
import android.content.Context;
import android.os.Bundle;
import android.util.Log;
import android.widget.TextView;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.concurrent.CompletableFuture;

/** Runs one credential-free Node startup test in a dedicated debug process. */
public final class NodeSmokeActivity extends Activity {
    private static final String TAG = "MinePilotNodeSmoke";
    private static final CompletableFuture<String> result = new CompletableFuture<>();
    private static boolean started;

    static native int runNode(String entrypoint);

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        TextView status = new TextView(this);
        status.setTextSize(18);
        status.setPadding(24, 24, 24, 24);
        status.setText("Checking Node.js, Bedrock codecs, and the NetherNet WebRTC backend…");
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
        Path directory = null;
        try {
            directory = Files.createTempDirectory(getCodeCacheDir().toPath(), "bedrock-sdk-");
            unpackSdk(this, directory);
            System.loadLibrary("minepilot_node_smoke");
            int exitCode = runNode(directory.resolve("node-smoke.cjs").toString());
            message = exitCode == 0
                    ? "PASS. Node.js 24, Bedrock 1.26.60 codecs, and NetherNet WebRTC loaded."
                    : "FAIL. The Bedrock SDK smoke test exited with code " + exitCode + ".";
        } catch (IOException | UnsatisfiedLinkError | SecurityException error) {
            Log.e(TAG, "Runtime initialization failed", error);
            message = "FAIL. The embedded Bedrock SDK could not start.";
        } finally {
            if (directory != null) removeSdk(directory);
        }
        Log.i(TAG, message);
        result.complete(message);
    }

    static void unpackSdk(Context context, Path directory) throws IOException {
        try (InputStream asset = context.getAssets().open("bedrock-sdk.zip");
                ZipInputStream zip = new ZipInputStream(asset)) {
            for (ZipEntry entry; (entry = zip.getNextEntry()) != null;) {
                Path target = directory.resolve(entry.getName()).normalize();
                if (!target.startsWith(directory) || target.equals(directory)) {
                    throw new IOException("Invalid SDK archive path");
                }
                if (entry.isDirectory()) {
                    Files.createDirectories(target);
                } else {
                    Files.createDirectories(target.getParent());
                    Files.copy(zip, target);
                }
            }
        }
    }

    static void removeSdk(Path directory) {
        try (var paths = Files.walk(directory)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).collect(Collectors.toList())) Files.deleteIfExists(path);
        } catch (IOException error) {
            Log.w(TAG, "Unable to remove SDK probe files", error);
        }
    }
}
