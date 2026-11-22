package ai.minepilot.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import java.io.IOException;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Owns the polling runtime while Microsoft approval is open in the browser. */
public final class XboxSignInService extends Service {
    static volatile Path statusPath;
    static volatile String completedMessage;
    static volatile boolean started;
    static volatile boolean joining;
    private volatile boolean notifyOnAccountSave;
    private volatile boolean accountReadBack;
    private static final int ACTIVE_NOTIFICATION = 6202;
    private static final int SIGN_IN_NOTIFICATION = 6201;
    private static final String SIGN_IN_CHANNEL = "minepilot_sign_in";

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (started) return START_NOT_STICKY;
        String host = intent == null ? null : intent.getStringExtra("host");
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(
                SIGN_IN_CHANNEL, "Xbox sign-in", NotificationManager.IMPORTANCE_LOW));
        Intent resume = new Intent(this, XboxAuthProbeActivity.class)
                .putExtra("host", host)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent open = PendingIntent.getActivity(this, ACTIVE_NOTIFICATION, resume,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        startForeground(ACTIVE_NOTIFICATION, new Notification.Builder(this, SIGN_IN_CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle(host == null ? "Xbox sign-in in progress" : "Connecting to friend’s world")
                .setContentText("Tap to return to MinePilot.")
                .setContentIntent(open)
                .setOngoing(true)
                .build());
        notifyOnAccountSave = host == null || !BotAccount.saved(this);
        startProbe(host);
        return START_NOT_STICKY;
    }

    private void startProbe(String host) {
        joining = host != null;
        if (!joining) XboxSignInReceiver.record(this, "");
        started = true;
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
                completedMessage = !joining && accountReadBack
                        ? "Xbox account verified and saved on this phone."
                        : last == null
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
                if (!joining && completedMessage != null) {
                    XboxSignInReceiver.record(this, completedMessage);
                }
                if (directory != null) NodeSmokeActivity.removeSdk(directory);
                if (!joining && notifyOnAccountSave) {
                    notifyOnAccountSave = false;
                    boolean accountSaved = accountReadBack;
                    if (!accountSaved && completedMessage != null && completedMessage.startsWith("PASS.")) {
                        completedMessage = "Xbox and Minecraft verification passed, but MinePilot could not save the account securely.";
                    }
                    String result = completedMessage == null
                            ? "Sign-in ended without a saved Xbox account." : completedMessage;
                    showSignInCompleteNotification(accountSaved, result);
                }
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
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
            accountReadBack = false;
        }
    }

    private void persistAccount(java.io.ByteArrayOutputStream bytes) throws Exception {
        if (bytes.size() == 0) return;
        JSONObject account = new JSONObject(bytes.toString("UTF-8"));
        BotAccount.save(this, account);
        if (!account.getString("xuid").equals(BotAccount.read(this).getString("xuid"))) {
            throw new IOException("Saved Xbox identity does not match");
        }
        accountReadBack = true;
        if (joining && notifyOnAccountSave) {
            notifyOnAccountSave = false;
            showSignInCompleteNotification(true, "Xbox account verified and saved on this phone.");
        }
    }

    private void showSignInCompleteNotification(boolean accountSaved, String result) {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(
                    SIGN_IN_CHANNEL, "Xbox sign-in", NotificationManager.IMPORTANCE_LOW));
        }
        Intent dashboard = new Intent(this, DashboardActivity.class)
                .putExtra("open_tab", "Xbox")
                .putExtra("sign_in_saved", accountSaved)
                .putExtra("sign_in_message", result)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP
                        | (joining ? Intent.FLAG_ACTIVITY_REORDER_TO_FRONT : Intent.FLAG_ACTIVITY_CLEAR_TOP));
        PendingIntent returnToApp = PendingIntent.getActivity(this, SIGN_IN_NOTIFICATION, dashboard,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder notification = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, SIGN_IN_CHANNEL)
                : new Notification.Builder(this);
        notification.setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle(accountSaved ? "Xbox account connected" : "Sign-in needs attention")
                .setContentText(accountSaved ? "Tap to return to MinePilot and continue."
                        : "Tap to return and review the sign-in result.")
                .setContentIntent(returnToApp)
                .setAutoCancel(true)
                .setPriority(Notification.PRIORITY_LOW);
        manager.notify(SIGN_IN_NOTIFICATION, notification.build());
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

    static JSONObject readStatus() {
        Path file = statusPath;
        if (file == null) return null;
        try {
            return new JSONObject(new String(Files.readAllBytes(file), StandardCharsets.UTF_8));
        } catch (IOException | JSONException absent) {
            return null;
        }
    }

    static String finalMessage(JSONObject snapshot, int exitCode) {
        if (exitCode == 0 && "verified".equals(snapshot.optString("phase"))) {
            return "PASS. Xbox and Minecraft Bedrock verified for " + snapshot.optString("gamertag")
                    + ".\nXbox ID " + snapshot.optString("xuid") + ".";
        }
        if ("disconnected".equals(snapshot.optString("phase"))) return "The friend-world connection closed.";
        if ("stopped".equals(snapshot.optString("phase"))) return "Friend-world test ended.";
        if ("account_sent".equals(snapshot.optString("phase"))) {
            return "Xbox verified the account, but MinePilot could not read it back from secure storage.";
        }
        switch (snapshot.optString("stage")) {
            case "xbox_token": return "Microsoft approved sign-in, but Xbox did not issue a session.";
            case "microsoft_token": return "Microsoft approval or token exchange did not complete. Start a fresh sign-in code.";
            case "xbox_profile": return "Microsoft approval succeeded, but the Xbox profile could not be loaded. Check that this account has an Xbox gamertag.";
            case "account_save": return "Xbox profile was verified, but MinePilot could not save the account securely.";
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
