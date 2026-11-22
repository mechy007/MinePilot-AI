package ai.minepilot.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
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
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ScrollView;
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
    private Button close;
    private Button openMicrosoft;
    private Button copyCode;
    private boolean browserOpened;
    private String currentCode;
    private static final int BG = Color.rgb(10, 12, 23);
    private static final int PANEL = Color.rgb(23, 27, 45);
    private static final int PURPLE = Color.rgb(157, 103, 255);
    private int dp(int value) { return (int) (getResources().getDisplayMetrics().density * value + .5f); }

    @Override public void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setPadding(dp(20), dp(18), dp(20), dp(18));
        TextView brand = new TextView(this);
        brand.setText("◆  MINEPILOT");
        brand.setTextColor(Color.WHITE);
        brand.setTextSize(20);
        brand.setTypeface(null, Typeface.BOLD);
        root.addView(brand, new LinearLayout.LayoutParams(-1, dp(52)));

        ScrollView scroll = new ScrollView(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(0, dp(8), 0, dp(18));
        scroll.addView(layout);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));

        TextView title = new TextView(this);
        title.setText(joiningIntent() ? "Connect to your friend" : "Connect your Xbox account");
        title.setTextColor(Color.WHITE);
        title.setTextSize(26);
        title.setTypeface(null, Typeface.BOLD);
        layout.addView(title);
        TextView description = new TextView(this);
        description.setText("MinePilot will open Microsoft sign-in. Approve the bot account there, then return here while MinePilot finishes automatically.");
        description.setTextColor(Color.rgb(166, 174, 197));
        description.setTextSize(15);
        description.setPadding(0, dp(8), 0, dp(18));
        layout.addView(description);

        LinearLayout accountCard = new LinearLayout(this);
        accountCard.setOrientation(LinearLayout.VERTICAL);
        accountCard.setPadding(dp(16), dp(16), dp(16), dp(16));
        accountCard.setBackground(rounded(PANEL, 18));
        status = new TextView(this);
        status.setTextSize(16);
        status.setTextColor(Color.WHITE);
        status.setText("Preparing secure Microsoft sign-in…");
        accountCard.addView(status);

        openMicrosoft = authButton("Open Microsoft sign-in");
        openMicrosoft.setVisibility(View.GONE);
        openMicrosoft.setOnClickListener(view -> openVerification());
        accountCard.addView(openMicrosoft);

        copyCode = authButton("Copy sign-in code");
        copyCode.setVisibility(View.GONE);
        copyCode.setOnClickListener(view -> copyCode());
        accountCard.addView(copyCode);
        layout.addView(accountCard);

        close = authButton(joiningIntent() ? "Stop connection" : "Cancel sign-in");
        close.setBackground(rounded(Color.rgb(39, 45, 66), 14));
        close.setOnClickListener(view -> endProbe());
        root.addView(close, new LinearLayout.LayoutParams(-1, dp(54)));
        setContentView(root);
        if (getIntent().getBooleanExtra("switch_account", false)) BotAccount.forget(this);
        startProbe();
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
        String host = getIntent().getStringExtra("host");
        if (host != null && (host.isEmpty() || host.length() > 32)) { finish(); return; }
        joining = host != null;
        started = true;
        refreshStatus();
        new Thread(() -> {
            Path directory = null;
            android.os.ParcelFileDescriptor[] savePipe = null;
            Thread accountWriter = null;
            try {
                Path cache = getCodeCacheDir().toPath();
                try (var stale = Files.newDirectoryStream(cache, "xbox-auth-probe-*")) {
                    for (Path old : stale) NodeSmokeActivity.removeSdk(old);
                }
                directory = Files.createTempDirectory(cache, "xbox-auth-probe-");
                NodeSmokeActivity.unpackSdk(this, directory);
                if (joining) Files.write(directory.resolve("owner-xuid"), host.getBytes(StandardCharsets.UTF_8));
                saveActiveNetworkAddresses(directory);
                statusPath = directory.resolve("auth-status.json");
                System.loadLibrary("minepilot_node_smoke");
                savePipe = android.os.ParcelFileDescriptor.createPipe();
                android.os.ParcelFileDescriptor accountSink = savePipe[0];
                accountWriter = new Thread(() -> readAndSaveAccount(accountSink), "minepilot-save-account");
                accountWriter.start();
                int exitCode;
                JSONObject sessionConfig = new JSONObject().put("saveFd", savePipe[1].getFd());
                if (joining) {
                    android.os.ParcelFileDescriptor account = BotAccount.saved(this)
                            ? getContentResolver().openFileDescriptor(
                                    Uri.parse("content://" + getPackageName() + ".bot-session/refresh"), "r")
                            : null;
                    try {
                        if (account != null) sessionConfig.put("fd", account.getFd());
                        Files.write(directory.resolve("device-session.json"),
                                sessionConfig.toString().getBytes(StandardCharsets.UTF_8));
                        exitCode = NodeSmokeActivity.runNode(directory.resolve("friend-world-session.cjs").toString());
                    } finally {
                        if (account != null) account.close();
                    }
                } else {
                    Files.write(directory.resolve("device-session.json"),
                            sessionConfig.toString().getBytes(StandardCharsets.UTF_8));
                    exitCode = NodeSmokeActivity.runNode(directory.resolve("xbox-auth-probe.cjs").toString());
                }
                savePipe[1].close();
                accountWriter.join(5000);
                JSONObject last = readStatus();
                completedMessage = last == null
                        ? "FAIL. The sign-in runtime exited with code " + exitCode + "."
                        : finalMessage(last, exitCode);
            } catch (IOException | JSONException | UnsatisfiedLinkError | SecurityException failure) {
                completedMessage = "FAIL. The Android sign-in runtime could not start.";
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                completedMessage = "Sign-in was interrupted. Try again.";
            } finally {
                if (savePipe != null) {
                    try { savePipe[1].close(); } catch (IOException ignored) {}
                }
                if (accountWriter != null && accountWriter.isAlive()) {
                    try { accountWriter.join(1500); } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt();
                    }
                }
                if (directory != null) NodeSmokeActivity.removeSdk(directory);
            }
        }, "minepilot-xbox-auth-probe").start();
    }

    private void readAndSaveAccount(android.os.ParcelFileDescriptor source) {
        try (java.io.InputStream in = new android.os.ParcelFileDescriptor.AutoCloseInputStream(source);
                java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[2048];
            for (int count; (count = in.read(buffer)) != -1;) {
                for (int i = 0; i < count; i++) {
                    if (buffer[i] == '\n') {
                        // The newline can arrive in the same pipe read as the JSON.
                        bytes.write(buffer, 0, i);
                        persistAccount(bytes);
                        return;
                    }
                }
                bytes.write(buffer, 0, count);
            }
            persistAccount(bytes);
        } catch (Exception error) {
            runOnUiThread(() -> status.setText(
                    "Sign-in finished, but MinePilot could not save the Xbox account securely."));
        }
    }

    private void persistAccount(java.io.ByteArrayOutputStream bytes) throws Exception {
        if (bytes.size() == 0) return;
        BotAccount.save(this, new JSONObject(bytes.toString("UTF-8")));
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
        close.setText(stopping && completedMessage == null ? "Force close"
                : joining ? "Stop connection" : "Cancel sign-in");
        if (completedMessage != null) {
            status.setText(completedMessage);
            return;
        }

        JSONObject current = readStatus();
        String phase = current == null ? "" : current.optString("phase");
        if (!"device_code".equals(phase)) {
            openMicrosoft.setVisibility(View.GONE);
            copyCode.setVisibility(View.GONE);
        }
        if ("device_code".equals(phase)) {
            currentCode = current.optString("code");
            status.setText("1  Open Microsoft and sign in\n\n2  Approve MinePilot\n\nYour code\n" + currentCode);
            openMicrosoft.setVisibility(View.VISIBLE);
            copyCode.setVisibility(View.VISIBLE);
            if (!browserOpened) openVerification();
        } else if (stopping) {
            openMicrosoft.setVisibility(View.GONE);
            copyCode.setVisibility(View.GONE);
            status.setText("Closing the friend-world session…");
        } else if ("bedrock_credentials".equals(phase)) {
            openMicrosoft.setVisibility(View.GONE);
            copyCode.setVisibility(View.GONE);
            status.setText("Xbox profile verified. Requesting Minecraft Bedrock credentials…");
        } else if ("discovery".equals(phase)) {
            status.setText("Signed in as " + current.optString("gamertag") + ". Looking for your friend’s world…");
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

    private boolean joiningIntent() {
        return getIntent() != null && getIntent().hasExtra("host");
    }

    private GradientDrawable rounded(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radius));
        return drawable;
    }

    private Button authButton(String title) {
        Button button = new Button(this);
        button.setText(title);
        button.setTextColor(Color.WHITE);
        button.setTextSize(15);
        button.setAllCaps(false);
        button.setTypeface(null, Typeface.BOLD);
        button.setGravity(Gravity.CENTER);
        button.setBackground(rounded(PURPLE, 14));
        return button;
    }

    private void openVerification() {
        JSONObject current = readStatus();
        if (current == null) return;
        Uri base = Uri.parse(current.optString("url"));
        if (!"https".equals(base.getScheme()) || !"microsoft.com".equals(base.getHost())
                && !"www.microsoft.com".equals(base.getHost())) return;
        Uri target = base.buildUpon().appendQueryParameter("otc", currentCode).build();
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, target));
            browserOpened = true;
        } catch (ActivityNotFoundException unavailable) {
            status.setText("Open microsoft.com/link and enter code " + currentCode + ".");
        }
    }

    private void copyCode() {
        if (currentCode == null) return;
        ClipboardManager clipboard = getSystemService(ClipboardManager.class);
        if (clipboard != null) {
            clipboard.setPrimaryClip(ClipData.newPlainText("MinePilot sign-in code", currentCode));
            status.setText("Code copied. Approve MinePilot on Microsoft’s sign-in page.");
        }
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
            case "owner": return "Could not identify a separate host. Check your friend’s gamertag or XUID.";
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
