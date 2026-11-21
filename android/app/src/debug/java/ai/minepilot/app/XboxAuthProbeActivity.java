package ai.minepilot.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.json.JSONException;
import org.json.JSONObject;

/** Interactive sign-in test in its own process. The SDK keeps account credentials in memory. */
public final class XboxAuthProbeActivity extends Activity {
    private static volatile Path statusPath;
    private static volatile String completedMessage;
    private static volatile boolean started;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable poll = this::refreshStatus;
    private TextView status;
    private Button start;
    private Button openMicrosoft;

    @Override public void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(24, 24, 24, 24);
        status = new TextView(this);
        status.setTextSize(18);
        status.setText("Verify the Microsoft account MinePilot will use on this phone.");
        status.setTextIsSelectable(true);
        layout.addView(status);

        start = new Button(this);
        start.setText("Start Microsoft sign-in");
        start.setOnClickListener(view -> startProbe());
        layout.addView(start);

        openMicrosoft = new Button(this);
        openMicrosoft.setText("Open Microsoft");
        openMicrosoft.setVisibility(View.GONE);
        layout.addView(openMicrosoft);

        Button close = new Button(this);
        close.setText("End test");
        close.setOnClickListener(view -> finish());
        layout.addView(close);
        setContentView(layout);
    }

    @Override protected void onStart() {
        super.onStart();
        refreshStatus();
    }

    @Override protected void onStop() {
        handler.removeCallbacks(poll);
        super.onStop();
    }

    @Override protected void onDestroy() {
        super.onDestroy();
        if (isFinishing() && started) {
            Path file = statusPath;
            if (file != null) {
                try {
                    Files.deleteIfExists(file);
                    Files.deleteIfExists(file.resolveSibling("auth-status.json.tmp"));
                } catch (IOException ignored) {
                    // The file is private to this diagnostic install.
                }
            }
            Process.killProcess(Process.myPid());
        }
    }

    private void startProbe() {
        if (started) return;
        started = true;
        refreshStatus();
        new Thread(() -> {
            Path directory = null;
            try {
                Path cache = getCodeCacheDir().toPath();
                try (var stale = Files.newDirectoryStream(cache, "xbox-auth-probe-*")) {
                    for (Path old : stale) NodeSmokeActivity.removeSdk(old);
                }
                directory = Files.createTempDirectory(cache, "xbox-auth-probe-");
                NodeSmokeActivity.unpackSdk(this, directory);
                statusPath = directory.resolve("auth-status.json");
                System.loadLibrary("minepilot_node_smoke");
                int exitCode = NodeSmokeActivity.runNode(directory.resolve("xbox-auth-probe.cjs").toString());
                JSONObject last = readStatus();
                completedMessage = last == null
                        ? "FAIL. The sign-in runtime exited with code " + exitCode + "."
                        : finalMessage(last, exitCode);
            } catch (IOException | UnsatisfiedLinkError | SecurityException failure) {
                completedMessage = "FAIL. The Android sign-in runtime could not start.";
            } finally {
                if (directory != null) NodeSmokeActivity.removeSdk(directory);
            }
        }, "minepilot-xbox-auth-probe").start();
    }

    private void refreshStatus() {
        handler.removeCallbacks(poll);
        if (!started) return;
        start.setEnabled(false);
        if (completedMessage != null) {
            status.setText(completedMessage);
            openMicrosoft.setVisibility(View.GONE);
            return;
        }

        JSONObject current = readStatus();
        String phase = current == null ? "" : current.optString("phase");
        openMicrosoft.setVisibility(View.GONE);
        if ("device_code".equals(phase)) {
            String url = current.optString("url");
            Uri uri = Uri.parse(url);
            if ("https".equals(uri.getScheme()) && uri.getUserInfo() == null && uri.getPort() == -1
                    && ("microsoft.com".equals(uri.getHost()) || "www.microsoft.com".equals(uri.getHost()))
                    && ("/link".equalsIgnoreCase(uri.getPath()) || "/devicelogin".equalsIgnoreCase(uri.getPath()))
                    && uri.getQuery() == null && uri.getFragment() == null) {
                status.setText("Enter this device code on Microsoft’s sign-in page.\n\n" + current.optString("code"));
                openMicrosoft.setVisibility(View.VISIBLE);
                openMicrosoft.setOnClickListener(view -> {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (ActivityNotFoundException unavailable) {
                        status.setText("Open " + url + " in your browser and enter " + current.optString("code") + ".");
                    }
                });
            }
        } else if ("bedrock_credentials".equals(phase)) {
            status.setText("Xbox profile verified. Requesting Minecraft Bedrock credentials…");
        } else {
            status.setText("Starting Microsoft sign-in…");
        }
        handler.postDelayed(poll, 350);
    }

    private static JSONObject readStatus() {
        Path file = statusPath;
        if (file == null) return null;
        try {
            return new JSONObject(new String(Files.readAllBytes(file), StandardCharsets.UTF_8));
        } catch (IOException | JSONException absent) {
            return null;
        }
    }

    private static String finalMessage(JSONObject snapshot, int exitCode) {
        if (exitCode == 0 && "verified".equals(snapshot.optString("phase"))) {
            return "PASS. Xbox and Minecraft Bedrock verified for " + snapshot.optString("gamertag")
                    + ".\nXbox ID " + snapshot.optString("xuid") + ".";
        }
        if ("bedrock_credentials".equals(snapshot.optString("stage"))) {
            return "FAIL. Xbox sign-in passed, but Minecraft Bedrock credentials could not be issued.";
        }
        return "FAIL. Microsoft or Xbox sign-in did not complete.";
    }
}
