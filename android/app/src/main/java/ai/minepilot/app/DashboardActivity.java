package ai.minepilot.app;

import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.view.WindowInsets;
import android.view.WindowInsets.Type;
import android.widget.Toast;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

public final class DashboardActivity extends Activity {
    private LinearLayout body;
    private TextView status;
    private String currentTab = "Home";
    // UI-thread-only generation counter prevents stale asynchronous diagnostic results.
    private int udpDiagnosticGeneration;
    private EditText xuidInput;
    private String xuidDraft;
    private static final int NOTIFICATION_REQUEST = 101;
    private static final int BG = Color.rgb(10, 12, 23);
    private static final int PANEL = Color.rgb(23, 27, 45);
    private static final int PURPLE = Color.rgb(157, 103, 255);
    private static final int MUTED = Color.rgb(166, 174, 197);
    private int dp(int value) { return (int)(getResources().getDisplayMetrics().density * value + .5f); }
    private GradientDrawable surface(int color, int radius) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color); d.setCornerRadius(dp(radius)); return d;
    }
    private TextView text(String value, int size, int color, boolean bold) {
        TextView t = new TextView(this); t.setText(value); t.setTextSize(size);
        t.setTextColor(color); if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return t;
    }
    private void label(String value, int size) {
        TextView t = text(value, size, size >= 19 ? Color.WHITE : MUTED, size >= 19);
        t.setPadding(dp(16), dp(14), dp(16), dp(14));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.setMargins(0, 0, 0, dp(10));
        t.setBackground(surface(PANEL, 16)); body.addView(t, lp);
    }
    private void button(String name, Runnable callback) {
        TextView b = text(name + "   ›", 15, Color.WHITE, true);
        b.setGravity(Gravity.CENTER_VERTICAL);
        b.setPadding(dp(18), dp(17), dp(18), dp(17));
        b.setBackground(surface(PANEL, 14));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.setMargins(0, 0, 0, dp(10)); body.addView(b, lp);
        b.setOnClickListener(v -> callback.run());
    }
    private void hero(String eyebrow, String headline, String detail) {
        LinearLayout panel = new LinearLayout(this); panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(20), dp(22), dp(20), dp(22));
        GradientDrawable gradient = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[]{Color.rgb(74, 39, 139), Color.rgb(31, 30, 72), PANEL});
        gradient.setCornerRadius(dp(22)); panel.setBackground(gradient);
        TextView tag = text(eyebrow, 12, Color.rgb(207, 181, 255), true);
        TextView title = text(headline, 28, Color.WHITE, true);
        TextView sub = text(detail, 14, Color.rgb(216, 215, 239), false);
        title.setPadding(0, dp(12), 0, dp(10));
        panel.addView(tag); panel.addView(title); panel.addView(sub);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.setMargins(0, 0, 0, dp(18)); body.addView(panel, lp);
    }
    private void launchDiagnostic(String activityName) {
        try {
            Intent intent = new Intent();
            intent.setClassName(getPackageName(), activityName);
            startActivity(intent);
        } catch (android.content.ActivityNotFoundException | SecurityException error) {
            status.setText("This diagnostic is available in the ARM64 runtime-enabled debug APK only.");
        }
    }
    private void disabled(String feature) {
        status.setText(feature + " is not implemented. No Minecraft packets sent.");
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) {
            currentTab = state.getString("tab", "Home");
            xuidDraft = state.getString("xuid_draft");
        }
        show(currentTab);
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        state.putString("tab", currentTab);
        if (xuidInput != null) state.putString("xuid_draft", xuidInput.getText().toString());
        super.onSaveInstanceState(state);
    }
    private void show(String tab) {
        if (xuidInput != null) xuidDraft = xuidInput.getText().toString();
        xuidInput = null;
        currentTab = tab;
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setPadding(dp(18), dp(12), dp(18), dp(10));
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(Type.systemBars() | Type.displayCutout());
                view.setPadding(dp(18) + bars.left, dp(12) + bars.top, dp(18) + bars.right, dp(10) + bars.bottom);
                return insets;
            });
        }
        LinearLayout heading = new LinearLayout(this); heading.setGravity(Gravity.CENTER_VERTICAL);
        TextView brand = text("◆  MINEPILOT", 21, Color.WHITE, true);
        heading.addView(brand, new LinearLayout.LayoutParams(0, dp(62), 1));
        brand.setGravity(Gravity.CENTER_VERTICAL);
        TextView version = text("AI  •  PREVIEW", 11, PURPLE, true);
        version.setGravity(Gravity.CENTER);
        heading.addView(version); root.addView(heading);
        TextView subtitle = text(tab.toUpperCase(java.util.Locale.ROOT) + "  /  CONTROL CENTER", 11, MUTED, true);
        subtitle.setPadding(dp(3), 0, 0, dp(14)); root.addView(subtitle);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true); scroll.setVerticalScrollBarEnabled(false);
        body = new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(0, dp(6), 0, dp(16)); scroll.addView(body);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        status = text("●  OFFLINE  •  No active Bedrock session", 12, MUTED, false);
        status.setPadding(dp(12), dp(12), dp(12), dp(12));
        status.setBackground(surface(PANEL, 12));
        root.addView(status);
        LinearLayout nav = new LinearLayout(this); nav.setGravity(Gravity.CENTER);
        nav.setPadding(0, dp(10), 0, 0);
        String[] pages = {"Home", "Xbox", "Commands", "Tasks", "Settings", "Logs"};
        String[] icons = {"⌂", "◎", "⌘", "▦", "⚙", "≡"};
        for (int i = 0; i < pages.length; i++) {
            final String page = pages[i];
            LinearLayout cell = new LinearLayout(this); cell.setOrientation(LinearLayout.VERTICAL);
            cell.setGravity(Gravity.CENTER); cell.setPadding(0, dp(9), 0, dp(9));
            if (tab.equals(page)) cell.setBackground(surface(Color.rgb(52, 38, 87), 12));
            TextView symbol = text(icons[i], 22, tab.equals(page) ? PURPLE : MUTED, true);
            symbol.setGravity(Gravity.CENTER); cell.addView(symbol);
            TextView caption = text(page, 10, tab.equals(page) ? Color.WHITE : MUTED, false);
            caption.setGravity(Gravity.CENTER); cell.addView(caption);
            nav.addView(cell, new LinearLayout.LayoutParams(0, -2, 1));
            cell.setOnClickListener(v -> show(page));
        }
        root.addView(nav); setContentView(root);
        switch (tab) {
            case "Xbox":
                hero("ACCOUNT & MULTIPLAYER", "Friend world", "Sign-in and join diagnostics • Experimental");
                label("Sign in with your own Xbox account when authentication is available. Enter your FRIEND'S world-owner XUID below, not your own Xbox ID. Never enter Microsoft credentials here.", 16);
                label(FriendWorldJoinReadiness.summary(new BedrockEngine.Unavailable()), 14);
                EditText xuid = new EditText(this);
                xuid.setTextColor(Color.WHITE);
                xuid.setHintTextColor(Color.LTGRAY);
                xuid.setHint("Friend world owner XUID (numeric)");
                xuid.setInputType(2);
                xuid.setText(xuidDraft != null ? xuidDraft : getPreferences(MODE_PRIVATE).getString("owner_xuid", ""));
                xuidInput = xuid;
                body.addView(xuid);
                button("Save owner XUID locally", () -> {
                    String value = xuid.getText().toString().trim();
                    try {
                        if (!value.matches("[0-9]{1,20}")) throw new NumberFormatException();
                        Long.parseUnsignedLong(value);
                        getPreferences(MODE_PRIVATE).edit().putString("owner_xuid", value).apply();
                        xuidDraft = value;
                        status.setText("Saved locally. No login attempted.");
                    } catch (NumberFormatException e) { status.setText("Invalid unsigned 64-bit XUID."); }
                });
                button("Check friend-world join readiness", () -> {
                    BedrockEngine engine = new BedrockEngine.Unavailable();
                    String owner = xuid.getText().toString().trim();
                    status.setText(FriendWorldJoinReadiness.summary(engine)
                            + (FriendWorldJoinReadiness.canAttemptJoin(engine, owner)
                            ? " / Ready to attempt join" : " / No join attempted"));
                });
                button("Sign in / Join friend\'s world", () -> launchDiagnostic("ai.minepilot.app.XboxAuthProbeActivity"));
                break;
            case "Commands":
                hero("AI COMMAND CENTER", "Bot commands", "Offline plans only • Live execution unavailable");
                label("Offline command planning is available; execution requires a live Bedrock session.", 16);
                for (String name : new String[]{"Follow", "Come here", "Protect", "Mine", "Gather wood", "Craft", "Build", "Explore", "Return"}) {
                    button("Plan " + name + " (offline)", () -> {
                        String action = name.equals("Come here") ? "come"
                                : name.equals("Gather wood") ? "gather" : name.toLowerCase(java.util.Locale.ROOT);
                        GameplayPlanner.Plan plan = GameplayPlanner.plan(GameplayPlanner.VERSION, action, "");
                        GameplayActionGate.Decision decision = GameplayActionGate.evaluate(plan,
                                new GameplayActionGate.Context(false, false, false, false, false));
                        status.setText(plan.status + " / " + decision + ": " + plan.message
                                + (plan.requiresConfirmation ? " (confirmation required before future execution)" : ""));
                    });
                }
                break;
            case "Tasks":
                hero("AUTOMATION", "Task library", "Upcoming autonomous Minecraft abilities");
                for (String name : new String[]{"Survival and safety", "Mining and gathering", "Crafting and inventory", "Navigation", "Blueprint building", "Redstone", "Memory and learning"}) {
                    label(name + " — planned, not implemented", 17);
                }
                break;
            case "Settings":
                hero("ENGINE & PERFORMANCE", "Diagnostics", "Runtime checks and developer tools");
                label("Performance: Balanced (future option)", 17);
                label("Native JNI bridge: " + NativeBridge.diagnostic(), 17);
                label("RakNet ping codec (offline only): " + NativeBridge.raknetCodecDiagnostic(), 17);
                label("RakNet pong codec (offline only): " + NativeBridge.raknetPongDiagnostic(), 17);
                label("RakNet request-1 codec (offline only): " + NativeBridge.raknetRequest1Diagnostic(), 17);
                label("RakNet handshake framing (offline only): " + NativeBridge.raknetHandshakeCodecDiagnostic(), 17);
                button("Test local RakNet ping UDP roundtrip", () -> {
                    final TextView settingsStatus = status;
                    final int requestGeneration = ++udpDiagnosticGeneration;
                    settingsStatus.setText("Local-only UDP roundtrip: testing...");
                    new Thread(() -> {
                        final String result = NativeBridge.raknetUdpLoopbackDiagnostic();
                        runOnUiThread(() -> {
                            if (!isFinishing() && !isDestroyed() && "Settings".equals(currentTab)
                                    && status == settingsStatus
                                    && requestGeneration == udpDiagnosticGeneration) {
                                settingsStatus.setText("Local-only UDP roundtrip: " + result);
                            }
                        });
                    }, "minepilot-udp-diagnostic").start();
                });
                button("Test native UDP loopback", () -> status.setText("UDP preflight: " + NativeBridge.udpDiagnostic()));
                TextView runtimeLabel = new TextView(this);
                runtimeLabel.setText("Android runtime preflight: " + RuntimeProbe.inspect(this));
                runtimeLabel.setTextSize(17);
                runtimeLabel.setTextColor(Color.WHITE);
                runtimeLabel.setPadding(12, 16, 12, 16);
                body.addView(runtimeLabel);
                label("A present ELF header does not prove the engine can run.", 14);
                button("Recheck runtime packaging", () -> {
                    String result = "Android runtime preflight: " + RuntimeProbe.inspect(this);
                    runtimeLabel.setText(result);
                    status.setText(result);
                });
                button("Run Node and NetherNet self-test", () -> launchDiagnostic("ai.minepilot.app.NodeSmokeActivity"));
                label("Same-phone world join: UNVERIFIED", 17);
                button("Stop diagnostic service", () -> {
                    stopService(new Intent(this, MinePilotService.class));
                    status.setText("Diagnostic service stop requested.");
                });
                break;
            case "Logs":
                hero("SYSTEM MONITOR", "Activity logs", "Local diagnostics • No live game telemetry");
                label("No real game telemetry is available in this build.", 16);
                label("Native JNI bridge: " + NativeBridge.diagnostic(), 16);
                label("RakNet ping codec (offline only): " + NativeBridge.raknetCodecDiagnostic(), 16);
                label("RakNet pong codec (offline only): " + NativeBridge.raknetPongDiagnostic(), 16);
                label("RakNet request-1 codec (offline only): " + NativeBridge.raknetRequest1Diagnostic(), 16);
                label("RakNet handshake framing (offline only): " + NativeBridge.raknetHandshakeCodecDiagnostic(), 16);
                label("Native UDP loopback (no packets sent): " + NativeBridge.udpDiagnostic(), 16);
                label("Runtime preflight: " + RuntimeProbe.inspect(this), 16);
                label("No authenticated Xbox or live Bedrock session has been verified.", 16);
                break;
            default:
                hero("●  BOT OFFLINE", "Your world. Your AI.", "Connect a separate Xbox bot account to explore friend-world joining.");
                label("CONNECTION OVERVIEW", 19);
                label("Connection: DISCONNECTED", 21);
                label("Xbox auth: unavailable\nFriend world discovery: unavailable\nSpawn: unavailable", 16);
                button("Connect bot (unavailable)", () -> disabled("Connect"));
                button("Start diagnostic service", () -> {
                    try {
                        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_REQUEST);
                        }
                        startForegroundService(new Intent(this, MinePilotService.class));
                        status.setText("Diagnostic service requested; bot remains offline.");
                    } catch (RuntimeException e) { status.setText("Service start failed: " + e.getClass().getSimpleName()); }
                });
                button("EMERGENCY STOP", () -> {
                    stopService(new Intent(this, MinePilotService.class));
                    status.setText("Stopped; no Minecraft connection.");
                });
        }
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_REQUEST && (grantResults.length == 0 || grantResults[0] != PackageManager.PERMISSION_GRANTED)) {
            status.setText("Notifications denied. Diagnostic service may still run, but its notification may be hidden.");
        }
    }
}
