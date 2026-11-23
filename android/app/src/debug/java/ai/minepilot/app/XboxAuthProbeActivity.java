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
import android.widget.ImageView;
import android.view.WindowInsets;
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
    private static final int BG = 0xff0d121b;
    private static final int PANEL = 0xff171f2e;
    private static final int GRASS = 0xff65e4ad;
    private int dp(int value) { return (int) (getResources().getDisplayMetrics().density * value + .5f); }

    @Override public void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setPadding(dp(20), dp(18), dp(20), dp(18));
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout());
                view.setPadding(dp(20) + bars.left, dp(18) + bars.top, dp(20) + bars.right, dp(18) + bars.bottom);
                return insets;
            });
        }
        LinearLayout heading = new LinearLayout(this);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        ImageView mark = new ImageView(this);
        mark.setImageResource(R.drawable.minepilot_icon_foreground);
        mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        heading.addView(mark, new LinearLayout.LayoutParams(dp(46), dp(46)));
        TextView brand = new TextView(this);
        brand.setText("MinePilot");
        brand.setTextColor(0xffeef4ff);
        brand.setTextSize(20);
        brand.setTypeface(null, Typeface.BOLD);
        heading.addView(brand);
        root.addView(heading, new LinearLayout.LayoutParams(-1, dp(52)));

        ScrollView scroll = new ScrollView(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(0, dp(8), 0, dp(18));
        scroll.addView(layout);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));

        TextView title = new TextView(this);
        title.setText(friendsIntent() ? "Refresh Xbox friends" : joiningIntent() ? "World Session" : "Connect your Xbox account");
        title.setTextColor(0xffeef4ff);
        title.setTextSize(26);
        title.setTypeface(null, Typeface.BOLD);
        layout.addView(title);
        TextView description = new TextView(this);
        description.setText(friendsIntent() ? "MinePilot is checking your saved Xbox account for friends and presence."
                : "MinePilot will open Microsoft sign-in. Approve the bot account there, then return here while MinePilot finishes automatically.");
        description.setTextColor(0xffadb9cd);
        description.setTextSize(15);
        description.setPadding(0, dp(8), 0, dp(18));
        layout.addView(description);

        LinearLayout accountCard = new LinearLayout(this);
        accountCard.setOrientation(LinearLayout.VERTICAL);
        accountCard.setPadding(dp(16), dp(16), dp(16), dp(16));
        accountCard.setBackground(rounded(PANEL, 6));
        status = new TextView(this);
        status.setTextSize(16);
        status.setTextColor(0xffeef4ff);
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
        if (joiningIntent()) {
            Button control = authButton("Open Command Center");
            control.setOnClickListener(view -> startActivity(new Intent(this, DashboardActivity.class)
                    .putExtra("open_tab", "World")));
            layout.addView(control);
        }
        Button logs = authButton("Open activity");
        logs.setOnClickListener(view -> startActivity(new Intent(this, DashboardActivity.class)
                .putExtra("open_tab", "Logs")));
        layout.addView(logs);

        close = authButton(joiningIntent() ? "Stop connection" : "Cancel sign-in");
        close.setBackground(rounded(PANEL, 6));
        close.setTextColor(0xffeef4ff);
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
            status.setText(current.optBoolean("retried")
                    ? "Retrying. Looking up your friend’s world again…"
                    : "Signed in as " + current.optString("gamertag") + ". Looking for your friend’s world…");
        } else if ("retrying".equals(phase)) {
            status.setText("NetherNet was interrupted. Trying once more…");
        } else if ("connection".equals(phase)) {
            status.setText("Friend’s world found. Waiting for Bedrock to finish joining…");
        } else if ("spawned".equals(phase)) {
            status.setText("Bot spawned in Minecraft\n\n"
                    + "Connected for " + current.optLong("seconds") + " seconds\n"
                    + "Level chunk packets received " + current.optLong("chunks") + botAwareness(current.optJSONObject("vitals")));
        } else if ("disconnected".equals(phase) || "failed".equals(phase) || "stopped".equals(phase)) {
            status.setText(XboxSignInService.finalMessage(current, -1));
        } else {
            status.setText("Starting Microsoft sign-in…");
        }
        handler.postDelayed(poll, 350);
    }

    private static String botAwareness(JSONObject vitals) {
        if (vitals == null) return "\n\nBot assessment · Waiting for health and hunger";
        String assessment = switch (vitals.optString("assessment")) {
            case "dead" -> "Bot is down";
            case "recover_health" -> "Health is low";
            case "needs_food" -> "Food is needed";
            case "ready" -> "Health and hunger are stable";
            default -> "Waiting for more status data";
        };
        String health = vitals.has("health") ? "\nHealth · " + vitals.optString("health") : "";
        String hunger = vitals.has("hunger") ? "\nHunger · " + vitals.optString("hunger") : "";
        return "\n\nBot assessment · " + assessment + health + hunger;
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
        button.setTextColor(BG);
        button.setTextSize(15);
        button.setAllCaps(false);
        button.setTypeface(null, Typeface.BOLD);
        button.setGravity(Gravity.CENTER);
        button.setBackground(rounded(GRASS, 6));
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
