package ai.minepilot.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
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
import java.nio.file.Files;
import java.nio.file.Path;
import org.json.JSONObject;

/** Interactive sign-in test in its own process. The SDK keeps account credentials in memory. */
public final class XboxAuthProbeActivity extends Activity {
    private static volatile boolean stopping;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable poll = this::refreshStatus;
    private TextView status;
    private Button close;
    private Button openMicrosoft;
    private Button copyCode;
    private static boolean browserOpened;
    private String currentCode;
    private boolean explicitlyClosed;
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
        title.setText(friendsIntent() ? "Refresh Xbox friends" : joiningIntent() ? "Connect to your friend" : "Connect your Xbox account");
        title.setTextColor(Color.WHITE);
        title.setTextSize(26);
        title.setTypeface(null, Typeface.BOLD);
        layout.addView(title);
        TextView description = new TextView(this);
        description.setText(friendsIntent() ? "MinePilot is checking your saved Xbox account for friends and presence."
                : "MinePilot will open Microsoft sign-in. Approve the bot account there, then return here while MinePilot finishes automatically.");
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
        if (!XboxSignInService.started) {
            String host = getIntent().getStringExtra("host");
            if (host != null && (host.isEmpty() || host.length() > 32)) {
                finish();
                return;
            }
            startForegroundService(new Intent(this, XboxSignInService.class).putExtra("host", host)
                    .putExtra("friends", friendsIntent()));
        }
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
        if (isFinishing() && (explicitlyClosed || XboxSignInService.completedMessage != null)) {
            Path file = XboxSignInService.statusPath;
            if (file != null) {
                try {
                    Files.deleteIfExists(file);
                    Files.deleteIfExists(file.resolveSibling("auth-status.json.tmp"));
                } catch (IOException ignored) {
                    // The file is private to this diagnostic install.
                }
            }
            stopService(new Intent(this, XboxSignInService.class));
            Process.killProcess(Process.myPid());
        }
    }

    @Override public void onBackPressed() {
        endProbe();
    }

    private void endProbe() {
        Path file = XboxSignInService.statusPath;
        if (XboxSignInService.joining && XboxSignInService.completedMessage == null && file != null) {
            if (stopping) {
                explicitlyClosed = true;
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
        if (!friendsIntent() && !XboxSignInService.joining && XboxSignInService.completedMessage == null) {
            XboxSignInReceiver.record(this, "Sign-in cancelled. Start a new attempt when ready.");
        }
        explicitlyClosed = true;
        finish();
    }

    private void refreshStatus() {
        handler.removeCallbacks(poll);
        if (!XboxSignInService.started) {
            handler.postDelayed(poll, 350);
            return;
        }
        close.setText(stopping && XboxSignInService.completedMessage == null ? "Force close"
                : XboxSignInService.joining ? "Stop connection" : friendsIntent() ? "Cancel refresh" : "Cancel sign-in");
        if (XboxSignInService.completedMessage != null) {
            openMicrosoft.setVisibility(View.GONE);
            copyCode.setVisibility(View.GONE);
            close.setText("Return to dashboard");
            status.setText(XboxSignInService.completedMessage);
            return;
        }

        JSONObject current = XboxSignInService.readStatus();
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
        } else if ("microsoft_approved".equals(phase)) {
            status.setText("Microsoft approved sign-in. Connecting to Xbox…");
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
            status.setText(XboxSignInService.finalMessage(current, -1));
        } else {
            status.setText("Starting Microsoft sign-in…");
        }
        handler.postDelayed(poll, 350);
    }

    private boolean friendsIntent() {
        return getIntent() != null && getIntent().getBooleanExtra("friends", false);
    }

    private boolean joiningIntent() {
        return getIntent() != null && getIntent().getStringExtra("host") != null;
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
        JSONObject current = XboxSignInService.readStatus();
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

}
