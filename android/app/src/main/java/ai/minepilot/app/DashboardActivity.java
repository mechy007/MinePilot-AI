package ai.minepilot.app;

import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.view.WindowInsets;
import android.view.WindowInsets.Type;
import android.widget.ImageView;
import android.graphics.drawable.RippleDrawable;
import android.content.res.ColorStateList;
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
    private TextView latestRuntimeStatus;
    private TextView runtimeEvents;
    private final android.os.Handler logRefresh = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable updateLogs = new Runnable() {
        @Override public void run() {
            if (!"Logs".equals(currentTab)) return;
            refreshRuntimeLogs();
            logRefresh.postDelayed(this, 1000);
        }
    };
    private String currentTab = "World";
    // UI-thread-only generation counter prevents stale asynchronous diagnostic results.
    private int udpDiagnosticGeneration;
    private EditText xuidInput;
    private String xuidDraft;
    private String pendingAuthHost;
    private boolean pendingAuthSwitch;
    private boolean pendingBotFlow;
    private static final int NOTIFICATION_REQUEST = 101;
    private static final int BG = 0xff151b15;
    private static final int PANEL = 0xff222c22;
    private static final int GRASS = 0xffa8d67d;
    private static final int INK = 0xffeff2e5;
    private static final int BORDER = 0xff40513c;
    private static final int MUTED = 0xffbac4b2;
    private int dp(int value) { return (int)(getResources().getDisplayMetrics().density * value + .5f); }
    private GradientDrawable surface(int color, int radius) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(radius));
        d.setStroke(dp(1), BORDER);
        return d;
    }
    private TextView text(String value, int size, int color, boolean bold) {
        TextView t = new TextView(this); t.setText(value); t.setTextSize(size);
        t.setTextColor(color); if (bold) t.setTypeface(Typeface.create("sans-serif-condensed", Typeface.BOLD));
        return t;
    }
    private void label(String value, int size) {
        TextView t = text(value, size, size >= 19 ? INK : MUTED, size >= 19);
        t.setPadding(dp(16), dp(14), dp(16), dp(14));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.setMargins(0, 0, 0, dp(10));
        t.setBackground(surface(PANEL, 6)); body.addView(t, lp);
    }
    private void button(String name, Runnable callback) {
        action(name, false, callback);
    }

    private void primaryButton(String name, Runnable callback) {
        action(name, true, callback);
    }

    private void action(String name, boolean primary, Runnable callback) {
        Button button = new Button(this);
        button.setText(name);
        button.setAllCaps(false);
        button.setTextSize(15);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setTextColor(primary ? 0xff182414 : INK);
        button.setGravity(Gravity.CENTER);
        button.setMinimumHeight(dp(50));
        button.setPadding(dp(14), dp(10), dp(14), dp(10));
        button.setBackground(new RippleDrawable(ColorStateList.valueOf(0x20708060),
                surface(primary ? GRASS : PANEL, 6), null));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.bottomMargin = dp(9);
        body.addView(button, params);
        button.setOnClickListener(view -> callback.run());
    }

    private void section(String name) {
        TextView heading = text(name, 17, INK, true);
        heading.setPadding(0, dp(15), 0, dp(9));
        body.addView(heading);
    }

    private void accountCard(boolean signedIn) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        card.setBackground(surface(PANEL, 6));
        TextView eyebrow = text("BOT ACCOUNT", 11, GRASS, true);
        card.addView(eyebrow);
        TextView title = text(signedIn ? BotAccount.gamertag(this) : "No account connected", 19, INK, true);
        title.setPadding(0, dp(8), 0, dp(4));
        card.addView(title);
        TextView detail = text(signedIn ? "Xbox account connected"
                : "Sign in with a separate Microsoft account for your bot.", 13, MUTED, false);
        card.addView(detail);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.setMargins(0, 0, 0, dp(14));
        body.addView(card, lp);
    }
    private void hero(String eyebrow, String headline, String detail) {
        LinearLayout panel = new LinearLayout(this);
        panel.setGravity(Gravity.CENTER_VERTICAL);
        panel.setPadding(dp(16), dp(16), dp(8), dp(16));
        GradientDrawable backdrop = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[]{0xff374e31, 0xff252f23});
        backdrop.setStroke(dp(1), 0xff56734a);
        backdrop.setCornerRadius(dp(6));
        panel.setBackground(backdrop);
        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        TextView tag = text(eyebrow, 11, GRASS, true);
        tag.setLetterSpacing(.1f);
        copy.addView(tag);
        TextView title = text(headline, 29, INK, true);
        title.setPadding(0, dp(4), 0, dp(5));
        copy.addView(title);
        copy.addView(text(detail, 14, MUTED, false));
        panel.addView(copy, new LinearLayout.LayoutParams(0, -2, 1));
        ImageView emblem = new ImageView(this);
        emblem.setImageResource(R.drawable.minepilot_icon_foreground);
        emblem.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        panel.addView(emblem, new LinearLayout.LayoutParams(dp(96), dp(96)));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.bottomMargin = dp(14);
        body.addView(panel, params);
    }

    private void launchDiagnostic(String activityName) {
        try {
            Intent intent = new Intent();
            intent.setClassName(getPackageName(), activityName);
            startActivity(intent);
        } catch (android.content.ActivityNotFoundException | SecurityException error) {
            showStatus("This diagnostic is available in the ARM64 runtime-enabled debug APK only.");
        }
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) {
            currentTab = state.getString("tab", "World");
            xuidDraft = state.getString("xuid_draft");
        } else if ("Xbox".equals(getIntent().getStringExtra("open_tab"))) {
            currentTab = "Xbox";
        } else if ("Logs".equals(getIntent().getStringExtra("open_tab"))) {
            currentTab = "Logs";
        }
        show(currentTab);
        showSignInReturnStatus(getIntent());
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        state.putString("tab", currentTab);
        state.putString("xuid_draft", xuidInput != null ? xuidInput.getText().toString() : xuidDraft);
        super.onSaveInstanceState(state);
    }
    @Override protected void onResume() {
        super.onResume();
        if ("Xbox".equals(currentTab) || "World".equals(currentTab)) show(currentTab);
        if ("Logs".equals(currentTab)) {
            logRefresh.removeCallbacks(updateLogs);
            updateLogs.run();
        }
    }

    @Override protected void onPause() {
        logRefresh.removeCallbacks(updateLogs);
        super.onPause();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String requestedTab = intent.getStringExtra("open_tab");
        if ("Xbox".equals(requestedTab) || "Logs".equals(requestedTab)) show(requestedTab);
        showSignInReturnStatus(intent);
    }

    private void showSignInReturnStatus(Intent intent) {
        if (intent == null || !intent.hasExtra("sign_in_saved")) return;
        String result = intent.getStringExtra("sign_in_message");
        if (result != null && !result.isEmpty()) {
            showStatus(result);
        } else if (intent.getBooleanExtra("sign_in_saved", false)) {
            showStatus("Xbox account saved. MinePilot returned from Microsoft sign-in.");
        } else {
            showStatus("Microsoft sign-in ended without an Xbox account. Review the sign-in result and try again.");
        }
    }

    private void openBotFlow(String host, boolean switchAccount) {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            pendingAuthHost = host;
            pendingAuthSwitch = switchAccount;
            pendingBotFlow = true;
            showStatus("Allow notifications so MinePilot can alert you when sign-in is complete.");
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_REQUEST);
            return;
        }
        launchBotFlow(host, switchAccount);
    }

    private void launchBotFlow(String host, boolean switchAccount) {
        launchBotFlow(host, switchAccount, false);
    }

    private void launchBotFlow(String host, boolean switchAccount, boolean friends) {
        Intent runtime = new Intent().setClassName(this, "ai.minepilot.app.XboxAuthProbeActivity");
        if (host != null) runtime.putExtra("host", host);
        if (friends) runtime.putExtra("friends", true);
        if (getPackageManager().resolveActivity(runtime, 0) == null) {
            showStatus("Install the ARM64 runtime-enabled APK to sign in and connect.");
            return;
        }
        if (switchAccount) runtime.putExtra("switch_account", true);
        runtime.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try {
            startActivity(runtime);
        } catch (android.content.ActivityNotFoundException | SecurityException error) {
            showStatus("The Xbox sign-in runtime is unavailable in this build.");
        }
    }
    private void showXboxFriends() {
        button("Refresh friends", () -> launchBotFlow(null, false, true));
        button("Send or accept requests on Xbox", () -> {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://play.xbox.com/")));
            } catch (android.content.ActivityNotFoundException unavailable) {
                showStatus("Open the Xbox app to manage friend requests.");
            }
        });
        org.json.JSONObject snapshot = XboxSignInReceiver.latestFriends(this);
        if (snapshot == null) return;
        org.json.JSONArray friends = snapshot.optJSONArray("friends");
        if (friends == null) return;
        long updated = snapshot.optLong("updatedAt");
        label((friends.length() == 0 ? "No Xbox friends found" : friends.length() + " Xbox friends")
                + (snapshot.optBoolean("truncated") ? " (partial list)" : "")
                + " · Updated " + java.text.DateFormat.getDateTimeInstance(
                        java.text.DateFormat.SHORT, java.text.DateFormat.SHORT).format(new java.util.Date(updated)), 14);
        for (int i = 0; i < friends.length(); i++) {
            org.json.JSONObject friend = friends.optJSONObject(i);
            if (friend == null) continue;
            String xuid = friend.optString("xuid");
            if (!xuid.matches("[0-9]{1,20}")) continue;
            String gamertag = friend.optString("gamertag");
            String name = gamertag.isEmpty() ? "Xbox player " + xuid : gamertag;
            String presence = friend.optString("state");
            String state = switch (presence) {
                case "Online", "Offline", "Away" -> presence;
                default -> "Status unavailable";
            };
            if (friend.optBoolean("minecraft")) {
                label(name + " · " + state + " · Playing Minecraft", 14);
                button("Check and join " + name, () -> openBotFlow(xuid, false));
            } else {
                label(name + " · " + state, 14);
            }
        }
    }

    private void show(String tab) {
        logRefresh.removeCallbacks(updateLogs);
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
        LinearLayout heading = new LinearLayout(this);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        ImageView mark = new ImageView(this);
        mark.setImageResource(R.drawable.minepilot_icon_foreground);
        mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        heading.addView(mark, new LinearLayout.LayoutParams(dp(46), dp(46)));
        TextView brand = text("MinePilot", 24, INK, true);
        heading.addView(brand, new LinearLayout.LayoutParams(-2, -2));
        root.addView(heading, new LinearLayout.LayoutParams(-1, dp(56)));
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true); scroll.setVerticalScrollBarEnabled(false);
        body = new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(0, dp(6), 0, dp(16)); scroll.addView(body);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        status = text("", 13, INK, false);
        status.setPadding(dp(12), dp(10), dp(12), dp(10));
        status.setBackground(surface(PANEL, 6));
        status.setVisibility(View.GONE);
        root.addView(status);
        LinearLayout nav = new LinearLayout(this);
        nav.setPadding(0, dp(8), 0, 0);
        for (String page : new String[]{"World", "Xbox", "Logs", "Settings"}) {
            boolean selected = page.equals(tab) || ("Settings".equals(page) && "Diagnostics".equals(tab));
            Button item = new Button(this);
            item.setText(page.equals("Xbox") ? "Friends" : page);
            item.setAllCaps(false);
            item.setTextSize(13);
            item.setTextColor(selected ? 0xff182414 : MUTED);
            item.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            item.setSelected(selected);
            item.setBackground(new RippleDrawable(ColorStateList.valueOf(0x20809070),
                    surface(selected ? GRASS : PANEL, 6), null));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(48), 1);
            params.setMargins(dp(3), 0, dp(3), 0);
            nav.addView(item, params);
            item.setOnClickListener(view -> show(page));
        }
        root.addView(nav);
        setContentView(root);

        boolean signedIn = BotAccount.saved(this);
        switch (tab) {
            case "Logs":
                showRuntimeLogs(signedIn);
                break;
            case "Xbox":
                hero("MULTIPLAYER", "Xbox friends", "See who’s around and check for a world you can join.");
                if (signedIn) {
                    showXboxFriends();
                } else {
                    accountCard(false);
                    primaryButton("Sign in with Microsoft", () -> openBotFlow(null, false));
                }
                String signInResult = XboxSignInReceiver.latest(this);
                if (!signInResult.isEmpty()) label(signInResult, 14);
                break;
            case "Settings":
                section("Xbox account");
                accountCard(signedIn);
                if (signedIn) {
                    button("Switch Xbox account", () -> openBotFlow(null, true));
                    button("Disconnect account", () -> new android.app.AlertDialog.Builder(this)
                            .setTitle("Disconnect Xbox account?")
                            .setMessage("Your saved sign-in and friends list will be removed from this phone.")
                            .setNegativeButton("Cancel", null)
                            .setPositiveButton("Disconnect", (dialog, which) -> {
                                BotAccount.forget(this);
                                XboxSignInReceiver.clearFriends(this);
                                XboxSignInReceiver.record(this, "");
                                show("Settings");
                            }).show());
                } else {
                    primaryButton("Sign in with Microsoft", () -> openBotFlow(null, false));
                }
                section("Support");
                button("Connection diagnostics", () -> show("Diagnostics"));
                break;
            case "Diagnostics":
                section("Connection diagnostics");
                label("Android runtime: " + RuntimeProbe.inspect(this), 14);
                label("Native bridge: " + NativeBridge.diagnostic(), 14);
                button("Run Node and NetherNet self-test", () -> launchDiagnostic("ai.minepilot.app.NodeSmokeActivity"));
                button("Run local UDP test", () -> {
                    showStatus("Testing local UDP…");
                    int generation = ++udpDiagnosticGeneration;
                    new Thread(() -> {
                        String result = NativeBridge.raknetUdpLoopbackDiagnostic();
                        runOnUiThread(() -> {
                            if (!isFinishing() && !isDestroyed() && "Diagnostics".equals(currentTab)
                                    && generation == udpDiagnosticGeneration) showStatus(result);
                        });
                    }, "minepilot-udp-diagnostic").start();
                });
                break;
            default:
                hero("WORLD HUB", "Ready to explore?", "Connect MinePilot to a friend’s Bedrock world.");
                accountCard(signedIn);
                if (signedIn) {
                    primaryButton("Find friends", () -> show("Xbox"));
                    showManualJoin();
                } else {
                    primaryButton("Sign in with Microsoft", () -> openBotFlow(null, false));
                    String result = XboxSignInReceiver.latest(this);
                    if (!result.isEmpty()) label(result, 14);
                }
        }
    }

    private void showRuntimeLogs(boolean signedIn) {
        section("App status");
        label(signedIn ? "Xbox account connected" : "Xbox account disconnected", 14);
        latestRuntimeStatus = text("", 16, INK, true);
        body.addView(latestRuntimeStatus);
        section("Recent events");
        button("Copy recent logs", () -> {
            android.content.ClipboardManager clipboard = getSystemService(android.content.ClipboardManager.class);
            var events = RuntimeLog.recent(this);
            if (clipboard == null || events.isEmpty()) return;
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("MinePilot logs", formatRuntimeEvents(events)));
        });
        runtimeEvents = text("", 14, MUTED, false);
        runtimeEvents.setTextIsSelectable(true);
        runtimeEvents.setLineSpacing(dp(5), 1f);
        body.addView(runtimeEvents);
        updateLogs.run();
    }

    private void refreshRuntimeLogs() {
        var events = RuntimeLog.recent(this);
        String latest = events.isEmpty() ? "Ready" : RuntimeLog.describe(events.getLast());
        latestRuntimeStatus.setText("Latest status · " + latest);
        String history = formatRuntimeEvents(events);
        if (!android.text.TextUtils.equals(runtimeEvents.getText(), history)) runtimeEvents.setText(history);
    }

    private String formatRuntimeEvents(java.util.ArrayDeque<org.json.JSONObject> events) {
        if (events.isEmpty()) return "No events yet. Try signing in or joining a world.";
        var timeFormat = java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.MEDIUM);
        var history = new StringBuilder();
        var newestFirst = events.descendingIterator();
        while (newestFirst.hasNext()) {
            var event = newestFirst.next();
            if (history.length() != 0) history.append('\n');
            history.append(timeFormat.format(new java.util.Date(event.optLong("at")))).append("  ")
                    .append(RuntimeLog.describe(event));
        }
        return history.toString();
    }

    private void showManualJoin() {
        section("Join by gamertag");
        EditText field = new EditText(this);
        field.setTextColor(INK);
        field.setHintTextColor(MUTED);
        field.setHint("Friend’s gamertag or Xbox XUID");
        field.setSingleLine(true);
        field.setInputType(android.text.InputType.TYPE_CLASS_TEXT);
        field.setPadding(dp(14), dp(12), dp(14), dp(12));
        field.setMinimumHeight(dp(48));
        field.setBackground(surface(PANEL, 6));
        field.setText(xuidDraft != null ? xuidDraft : getPreferences(MODE_PRIVATE).getString("owner_xuid", ""));
        xuidInput = field;
        LinearLayout.LayoutParams input = new LinearLayout.LayoutParams(-1, -2);
        input.bottomMargin = dp(9);
        body.addView(field, input);
        button("Check and join world", () -> {
            String host = field.getText().toString().trim();
            if (host.isEmpty() || host.length() > 32) {
                field.setError("Enter your friend’s gamertag or Xbox XUID.");
                return;
            }
            getPreferences(MODE_PRIVATE).edit().putString("owner_xuid", host).apply();
            openBotFlow(host, false);
        });
    }

    private void showStatus(String message) {
        status.setText(message);
        status.setVisibility(View.VISIBLE);
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != NOTIFICATION_REQUEST) return;
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (pendingBotFlow) {
            String host = pendingAuthHost;
            boolean switchAccount = pendingAuthSwitch;
            pendingBotFlow = false;
            pendingAuthHost = null;
            if (!granted) showStatus("Sign-in will continue. Return to MinePilot manually after Microsoft approval.");
            launchBotFlow(host, switchAccount);
        } else if (!granted) {
            showStatus("Notifications are off. Return to MinePilot manually after Microsoft approval.");
        }
    }
}
