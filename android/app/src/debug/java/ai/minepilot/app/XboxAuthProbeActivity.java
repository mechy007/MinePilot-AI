package ai.minepilot.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.text.InputType;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.IOException;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Interactive sign-in test in its own process. The SDK keeps account credentials in memory. */
public final class XboxAuthProbeActivity extends Activity {
    private static volatile Path statusPath;
    private static volatile String completedMessage;
    private static volatile boolean started;
    private static volatile boolean stopping;
    private static volatile boolean joining;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable poll = this::refreshStatus;
    private TextView status;
    private Button start;
    private EditText owner;
    private Button openMicrosoft;
    private Button close;
    private boolean joinRequested;

    @Override public void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(24, 24, 24, 24);
        status = new TextView(this);
        status.setTextSize(18);
        status.setText("Secure Microsoft device-code sign-in. MinePilot never asks for your password. Use a separate Xbox account for the bot.");
        status.setTextIsSelectable(true);
        layout.addView(status);

        owner = new EditText(this);
        owner.setText(getSharedPreferences("DashboardActivity", MODE_PRIVATE).getString("owner_xuid", ""));
        owner.setHint("Friend’s Xbox ID (XUID), optional");
        owner.setInputType(InputType.TYPE_CLASS_NUMBER);
        owner.setFilters(new android.text.InputFilter[] { new android.text.InputFilter.LengthFilter(20) });
        layout.addView(owner);

        start = new Button(this);
        start.setText("Sign in with Microsoft");
        start.setOnClickListener(view -> { joinRequested = false; startProbe(); });
        Button join = new Button(this);
        join.setText("Sign in and join friend’s world");
        join.setOnClickListener(view -> { joinRequested = true; startProbe(); });
        layout.addView(join);
        layout.addView(start);

        openMicrosoft = new Button(this);
        openMicrosoft.setText("Open Microsoft");
        openMicrosoft.setVisibility(View.GONE);
        layout.addView(openMicrosoft);

        close = new Button(this);
        close.setText("End test");
        close.setOnClickListener(view -> endProbe());
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

    @Override public void onBackPressed() {
        endProbe();
    }

    private void endProbe() {
        Path file = statusPath;
        if (joining && completedMessage == null && file != null) {
            if (stopping) {
                finish();
                return;
            }
            try {
                Files.write(file.resolveSibling("stop-session"), new byte[0]);
                stopping = true;
                refreshStatus();
                return;
            } catch (IOException ignored) {
                // Fall back to closing the isolated runtime process.
            }
        }
        finish();
    }

    private void startProbe() {
        if (started) return;
        String ownerXuid = owner.getText().toString().trim();
        if (!ownerXuid.isEmpty()) {
            try {
                if (!ownerXuid.matches("[1-9][0-9]{0,19}")) throw new NumberFormatException();
                Long.parseUnsignedLong(ownerXuid);
            } catch (NumberFormatException invalid) {
                owner.setError("Enter the world owner’s numeric Xbox ID.");
                return;
            }
        }
        if (joinRequested && ownerXuid.isEmpty()) {
            owner.setError("Enter your friend’s numeric XUID before joining.");
            return;
        }
        joining = joinRequested;
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
                if (joining) {
                    Files.write(directory.resolve("owner-xuid"), ownerXuid.getBytes(StandardCharsets.UTF_8));
                    saveActiveNetworkAddresses(directory);
                }
                statusPath = directory.resolve("auth-status.json");
                System.loadLibrary("minepilot_node_smoke");
                String entrypoint = joining ? "friend-world-session.cjs" : "xbox-auth-probe.cjs";
                int exitCode = NodeSmokeActivity.runNode(directory.resolve(entrypoint).toString());
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

    private void saveActiveNetworkAddresses(Path directory) throws IOException {
        ConnectivityManager connectivity = getSystemService(ConnectivityManager.class);
        if (connectivity == null) return;
        Network active = connectivity.getActiveNetwork();
        if (active == null) return;
        LinkProperties properties = connectivity.getLinkProperties(active);
        if (properties == null) return;

        JSONArray addresses = new JSONArray();
        for (var link : properties.getLinkAddresses()) {
            InetAddress address = link.getAddress();
            if (address.isLoopbackAddress() || address.isLinkLocalAddress() || address.isAnyLocalAddress()) continue;
            String host = address.getHostAddress();
            int scope = host.indexOf('%');
            addresses.put(scope == -1 ? host : host.substring(0, scope));
        }
        if (addresses.length() > 0) {
            Files.write(directory.resolve("network-addresses.json"), addresses.toString().getBytes(StandardCharsets.UTF_8));
        }
    }

    private void refreshStatus() {
        handler.removeCallbacks(poll);
        if (!started) return;
        start.setEnabled(false);
        owner.setEnabled(false);
        close.setText(stopping && completedMessage == null ? "Force close" : "End test");
        if (completedMessage != null) {
            status.setText(completedMessage);
            openMicrosoft.setVisibility(View.GONE);
            return;
        }

        JSONObject current = readStatus();
        String phase = current == null ? "" : current.optString("phase");
        openMicrosoft.setVisibility(View.GONE);
        if (stopping) {
            status.setText("Closing the friend-world session…");
        } else if ("device_code".equals(phase)) {
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
        } else if ("discovery".equals(phase)) {
            status.setText("Looking for the specified friend’s Xbox world…");
        } else if ("connection".equals(phase)) {
            status.setText("Friend’s world found. Waiting for Bedrock to finish joining…");
        } else if ("spawned".equals(phase)) {
            status.setText("Bedrock spawn received. Ask the host to confirm the bot appears in the player list.\n\n"
                    + "Connected for " + current.optLong("seconds") + " seconds\n"
                    + "Level chunk packets received " + current.optLong("chunks"));
        } else if ("disconnected".equals(phase) || "failed".equals(phase) || "stopped".equals(phase)) {
            status.setText(finalMessage(current, -1));
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
        if ("disconnected".equals(snapshot.optString("phase"))) return "The friend-world connection closed.";
        if ("stopped".equals(snapshot.optString("phase"))) return "Friend-world test ended.";
        switch (snapshot.optString("stage")) {
            case "owner": return "Enter your friend’s Xbox ID. The bot and host must use different accounts.";
            case "discovery": return "The selected owner’s compatible world could not be found on Xbox.";
            case "connection": return "The friend’s world was found, but the Bedrock session failed.";
            case "runtime": return "The embedded friend-world runtime could not start.";
            default: break;
        }
        if ("bedrock_credentials".equals(snapshot.optString("stage"))) {
            return "FAIL. Xbox sign-in passed, but Minecraft Bedrock credentials could not be issued.";
        }
        return "FAIL. Microsoft or Xbox sign-in did not complete.";
    }
}
