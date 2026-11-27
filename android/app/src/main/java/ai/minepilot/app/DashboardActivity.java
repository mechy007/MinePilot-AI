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
import android.net.Uri;
import android.view.Gravity;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public final class DashboardActivity extends Activity {
    private LinearLayout body;
    private TextView status;
    private TextView latestRuntimeStatus;
    private TextView runtimeEvents;
    private TextView worldState;
    private TextView worldDetail;
    private TextView worldHealth;
    private TextView worldHunger;
    private TextView lastEvent;
    private TextView gameplayStatus;
    private Button telemetryExpand;
    private boolean telemetryExpanded;
    private final android.os.Handler manualControlHandler =
            new android.os.Handler(android.os.Looper.getMainLooper());
    private String activeManualMode = "";
    private float manualJoystickX;
    private float manualJoystickY;
    private boolean manualJump;
    private boolean manualSprint;
    private boolean manualSneak;
    private String manualLookMode = "";
    private int manualControlGeneration;
    private boolean manualControlsEnabled;
    private ManualControlPanel manualControlPanel;
    private TextView manualControlStatus;
    private boolean manualMovementReady;
    private boolean manualQueueNoticeShown;
    private final Runnable repeatManualControl = new Runnable() {
        @Override public void run() {
            if (activeManualMode.isEmpty() || !manualControlsEnabled) return;
            sendManualMotionPulse(activeManualMode);
            manualControlHandler.postDelayed(this, 450);
        }
    };
    private LifeAnalyticsView lifeAnalytics;
    private HealthMonitorView healthMonitor;
    private FirstPersonVoxelView firstPersonView;
    private TextView brainStatus;
    private Button autoFollow;
    private Button autoStop;
    private Button gameplayAgentStart;
    private Button gameplayAgentStop;
    private TextView gameplayAgentState;
    private TextView learningState;
    private Button learningStart;
    private Button learningStop;
    private Button learningAutopilot;
    private boolean learningAutopilotEnabled;
    private String learningNextTaskId = "";
    private Button experimentalBreak;
    private Button stopMovement;
    private Button inspectWorld;
    private Button waitHere;
    private Button planFollow;
    private Button planReturn;
    private Button markHome;
    private Button planCollect;
    private Button inspectUpdatedBlocks;
    private Button planFood;
    private Button planShelter;
    private Button planPlanks;
    private Button planFarm;
    private Button planStorage;
    private Button advisorMode;
    private Button advisorReview;
    private Button stopWorld;
    private Button joinFriend;
    private Button immediateRespawnButton;
    private boolean failuresOnly;
    private String worldSessionId = "";
    private boolean dashboardVisible;
    private boolean worldRuntimeAvailable;
    private int worldViewGeneration;
    private final java.util.concurrent.ExecutorService worldReader = Executors.newSingleThreadExecutor();
    private final Runnable pollWorld = this::refreshCommandCenter;
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
    private static final int BG = MinePilotTheme.BACKGROUND;
    private static final int PANEL = MinePilotTheme.SURFACE;
    private static final int GRASS = MinePilotTheme.ACCENT;
    private static final int INK = MinePilotTheme.TEXT_PRIMARY;
    private static final int BORDER = MinePilotTheme.BORDER;
    private static final int MUTED = MinePilotTheme.TEXT_SECONDARY;
    private static final int AMBER = MinePilotTheme.WARNING;
    private int dp(int value) { return MinePilotTheme.dp(this, value); }
    private GradientDrawable surface(int color, int radius) {
        return MinePilotTheme.surface(this, color, radius);
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
        body.addView(actionButton(name, primary, callback), panelLayout(9));
    }

    private LinearLayout.LayoutParams panelLayout(int margin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.bottomMargin = dp(margin);
        return params;
    }

    private Button actionButton(String name, boolean primary, Runnable callback) {
        Button button = new Button(this);
        button.setText(name);
        button.setAllCaps(false);
        button.setTextSize(15);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setTextColor(primary ? BG : INK);
        button.setGravity(Gravity.CENTER);
        button.setMinimumHeight(dp(50));
        button.setPadding(dp(14), dp(10), dp(14), dp(10));
        button.setBackground(new RippleDrawable(ColorStateList.valueOf(0x2673dab6),
                surface(primary ? GRASS : PANEL, 12), null));
        button.setOnClickListener(view -> callback.run());
        return button;
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
                new int[]{0xff193a36, 0xff172236});
        backdrop.setStroke(dp(1), 0xff37645e);
        backdrop.setCornerRadius(dp(16));
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
        worldRuntimeAvailable = getPackageManager().resolveContentProvider(getPackageName() + ".world-session", 0) != null;
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
        dashboardVisible = true;
        if ("Xbox".equals(currentTab) || "World".equals(currentTab) || "Manual".equals(currentTab)) show(currentTab);
        if ("Logs".equals(currentTab)) {
            logRefresh.removeCallbacks(updateLogs);
            updateLogs.run();
        }
    }

    @Override protected void onPause() {
        stopManualControl();
        manualControlsEnabled = false;
        dashboardVisible = false;
        worldViewGeneration++;
        logRefresh.removeCallbacks(pollWorld);
        logRefresh.removeCallbacks(updateLogs);
        super.onPause();
    }

    @Override protected void onDestroy() {
        // stopManualControl queues a neutral input on the single session
        // executor. Drain that safety release instead of cancelling it with
        // shutdownNow while the activity is being destroyed.
        stopManualControl();
        manualControlsEnabled = false;
        manualControlHandler.removeCallbacksAndMessages(null);
        worldReader.shutdown();
        super.onDestroy();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String requestedTab = intent.getStringExtra("open_tab");
        if ("World".equals(requestedTab) || "Manual".equals(requestedTab) || "Xbox".equals(requestedTab) || "Logs".equals(requestedTab)) show(requestedTab);
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
            boolean playing = friend.optBoolean("minecraft");
            LinearLayout card = card();
            card.addView(text(name, 18, INK, true));
            card.addView(text(playing ? state + " · Playing Minecraft" : state, 13, playing ? GRASS : MUTED, false));
            if (playing) {
                Button join = actionButton("Check and join", false, () -> openBotFlow(xuid, false));
                join.setContentDescription("Check and join " + name);
                LinearLayout.LayoutParams action = panelLayout(0);
                action.topMargin = dp(8);
                card.addView(join, action);
            }
            body.addView(card, panelLayout(8));
        }
    }

    private void show(String tab) {
        stopManualControl();
        manualControlPanel = null;
        manualControlsEnabled = false;
        logRefresh.removeCallbacks(updateLogs);
        logRefresh.removeCallbacks(pollWorld);
        worldViewGeneration++;
        if (xuidInput != null) xuidDraft = xuidInput.getText().toString();
        xuidInput = null;
        currentTab = tab;
        manualControlStatus = null;
        immediateRespawnButton = null;
        manualMovementReady = false;
        manualQueueNoticeShown = false;
        DashboardShell shell = new DashboardShell(this, tab, this::show);
        body = shell.content();
        status = shell.status();
        setContentView(shell);

        boolean signedIn = BotAccount.saved(this);
        switch (tab) {
            case "Manual":
                showManualControlScreen(signedIn);
                break;
            case "Skills":
                showSkills();
                break;
            case "Logs":
                showRuntimeLogs(signedIn);
                break;
            case "Xbox":
                hero("MULTIPLAYER", "Xbox friends", "See who’s around and check for a world you can join.");
                if (signedIn) {
                    showManualJoin();
                    section("Friends list");
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
                showCommandCenter(signedIn);
        }
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(15), dp(13), dp(15), dp(13));
        card.setBackground(surface(PANEL, 14));
        return card;
    }

    private void showManualControlScreen(boolean signedIn) {
        hero("DIRECT INPUT", "Manual Control",
                signedIn ? "Control your connected Minecraft Bedrock player." :
                        "Sign in with Xbox and join a friend's world to use the controller.");

        LinearLayout session = card();
        session.addView(text("WORLD SESSION", 11, GRASS, true));
        worldState = text("Checking world connection…", 22, INK, true);
        worldState.setPadding(0, dp(6), 0, dp(2));
        session.addView(worldState);
        worldDetail = text("Waiting for a Bedrock session", 13, MUTED, false);
        session.addView(worldDetail);
        manualControlStatus = text("Checking movement and connection readiness…", 12, MUTED, false);
        manualControlStatus.setPadding(0, dp(9), 0, 0);
        session.addView(manualControlStatus);
        addImmediateRespawnButton(session);
        body.addView(session, panelLayout(10));

        LinearLayout vitals = new LinearLayout(this);
        worldHealth = addVital(vitals, "Health", 8);
        worldHunger = addVital(vitals, "Hunger", 0);
        body.addView(vitals, panelLayout(10));

        LinearLayout healthCard = card();
        healthCard.addView(text("SYSTEM HEALTH · LIVE", 11, GRASS, true));
        healthMonitor = new HealthMonitorView(this);
        healthCard.addView(healthMonitor, new LinearLayout.LayoutParams(-1, dp(252)));
        body.addView(healthCard, panelLayout(10));

        if (!signedIn) {
            primaryButton("Sign in with Microsoft", () -> openBotFlow(null, false));
        } else {
            button("Find or join a friend's world", () -> show("Xbox"));
        }
        addManualControlPanel();
        refreshCommandCenter();
    }

    private void showCommandCenter(boolean signedIn) {
        hero("BEDROCK · XBOX", "Command Center",
                signedIn ? "Bot account · " + BotAccount.gamertag(this) : "Connect an Xbox account to join your friends.");
        LinearLayout session = card();
        session.addView(text("WORLD SESSION", 11, GRASS, true));
        worldState = text("Bot on standby", 22, INK, true);
        worldState.setPadding(0, dp(6), 0, dp(2));
        session.addView(worldState);
        worldDetail = text("No active connection", 13, MUTED, false);
        session.addView(worldDetail);
        addImmediateRespawnButton(session);
        body.addView(session, panelLayout(10));

        LinearLayout vitals = new LinearLayout(this);
        worldHealth = addVital(vitals, "Health", 8);
        worldHunger = addVital(vitals, "Hunger", 0);
        body.addView(vitals, panelLayout(10));

        LinearLayout healthCard = card();
        healthCard.addView(text("SYSTEM HEALTH · LIVE", 11, GRASS, true));
        healthMonitor = new HealthMonitorView(this);
        healthCard.addView(healthMonitor, new LinearLayout.LayoutParams(-1, dp(252)));
        body.addView(healthCard, panelLayout(10));

        // Manual movement has its own screen so the world overview remains focused.

        // Keep experimental visualizations available without letting them
        // dominate the primary movement/control screen.
        LinearLayout visualizations = new LinearLayout(this);
        visualizations.setOrientation(LinearLayout.VERTICAL);
        visualizations.setVisibility(View.GONE);

        LinearLayout analytics = card();
        analytics.addView(text("VISUAL ANALYTICS · LIVE SURVIVAL", 11, GRASS, true));
        lifeAnalytics = new LifeAnalyticsView(this);
        analytics.addView(lifeAnalytics, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(240)));
        visualizations.addView(analytics, panelLayout(10));

        LinearLayout povCard = card();
        povCard.addView(text("BOT CAMERA · EXPERIMENTAL RECONSTRUCTION", 11, GRASS, true));
        firstPersonView = new FirstPersonVoxelView(this);
        povCard.addView(firstPersonView, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(190)));
        povCard.addView(text("Reconstructed from decoded block observations; this is not a live Minecraft video stream.",
                11, MUTED, false));
        visualizations.addView(povCard, panelLayout(10));

        Button visualToggle = actionButton("Show world visualizations · Experimental", false, () -> {});
        visualToggle.setOnClickListener(view -> {
            boolean visible = visualizations.getVisibility() != View.VISIBLE;
            visualizations.setVisibility(visible ? View.VISIBLE : View.GONE);
            visualToggle.setText(visible ? "Hide world visualizations" : "Show world visualizations · Experimental");
        });
        body.addView(visualToggle, panelLayout(8));
        body.addView(visualizations, panelLayout(10));

        LinearLayout intelligencePanel = card();
        intelligencePanel.addView(text("AI BRAIN  ·  LIVE DECISIONS", 11, GRASS, true));
        brainStatus = text("Waiting for the bot's first world observations", 13, MUTED, false);
        brainStatus.setPadding(0, dp(9), 0, dp(4));
        intelligencePanel.addView(brainStatus);
        gameplayAgentState = text("Gameplay agent inactive", 12, MUTED, false);
        gameplayAgentState.setPadding(0, dp(7), 0, dp(1));
        intelligencePanel.addView(gameplayAgentState);
        body.addView(intelligencePanel, panelLayout(10));

        LinearLayout learningPanel = card();
        learningPanel.addView(text("VOYAGER + ODYSSEY LEARNING", 11, GRASS, true));
        learningState = text("Join a Bedrock world to inspect the learning curriculum.", 13, MUTED, false);
        learningState.setPadding(0, dp(8), 0, dp(4));
        learningPanel.addView(learningState);
        body.addView(learningPanel, panelLayout(8));
        learningStart = actionButton("Start recommended learning task", true, this::confirmLearningStart);
        learningStart.setVisibility(View.GONE);
        body.addView(learningStart, panelLayout(8));
        learningStop = actionButton("Stop learning task", false,
                () -> requestGameplay("learning_stop", false));
        learningStop.setVisibility(View.GONE);
        body.addView(learningStop, panelLayout(8));
        learningAutopilot = actionButton("Enable local autopilot", true, this::toggleLocalAutopilot);
        learningAutopilot.setVisibility(View.GONE);
        body.addView(learningAutopilot, panelLayout(8));

        LinearLayout gameplay = card();
        gameplay.addView(text("GAMEPLAY TELEMETRY", 11, GRASS, true));
        gameplayStatus = text("Waiting for a server-reported position", 13, MUTED, false);
        gameplayStatus.setPadding(0, dp(5), 0, dp(6));
        gameplayStatus.setMaxLines(14);
        gameplayStatus.setEllipsize(android.text.TextUtils.TruncateAt.END);
        gameplay.addView(gameplayStatus);
        telemetryExpand = actionButton("Show full diagnostics", false, () -> {
            telemetryExpanded = !telemetryExpanded;
            gameplayStatus.setMaxLines(telemetryExpanded ? Integer.MAX_VALUE : 14);
            gameplayStatus.setEllipsize(telemetryExpanded ? null : android.text.TextUtils.TruncateAt.END);
            telemetryExpand.setText(telemetryExpanded ? "Collapse diagnostics" : "Show full diagnostics");
        });
        gameplay.addView(telemetryExpand, panelLayout(2));
        body.addView(gameplay, panelLayout(10));
        inspectWorld = actionButton("Inspect bot status", false, () -> requestGameplay("inspect", false));
        inspectWorld.setVisibility(View.GONE);
        body.addView(inspectWorld, panelLayout(8));
        waitHere = actionButton("Stay here", false, () -> requestGameplay("stay", false));
        waitHere.setVisibility(View.GONE);
        body.addView(waitHere, panelLayout(8));
        section("Companion and planning previews");
        planFollow = actionButton("Follow player (experimental)", false, this::requestFollowPlan);
        planFollow.setVisibility(View.GONE);
        body.addView(planFollow, panelLayout(8));
        markHome = actionButton("Mark current position as home", false, () -> requestGameplay("set_home", false));
        markHome.setVisibility(View.GONE);
        body.addView(markHome, panelLayout(8));
        planReturn = actionButton("Plan return home", false, () -> requestGameplay("plan_return", false));
        planReturn.setVisibility(View.GONE);
        body.addView(planReturn, panelLayout(8));
        planCollect = actionButton("Plan collection of observed item", false, this::requestCollectionPlan);
        planCollect.setVisibility(View.GONE);
        body.addView(planCollect, panelLayout(8));
        inspectUpdatedBlocks = actionButton("Inspect recent block updates", false,
                () -> requestGameplay("inspect_block", false));
        inspectUpdatedBlocks.setVisibility(View.GONE);
        body.addView(inspectUpdatedBlocks, panelLayout(8));
        planFood = actionButton("Plan food from observed inventory", false,
                () -> requestGameplay("plan_food", false));
        planFood.setVisibility(View.GONE);
        body.addView(planFood, panelLayout(8));
        planShelter = actionButton("Plan 3×3 shelter (no placement)", false, this::requestShelterPlan);
        planShelter.setVisibility(View.GONE);
        body.addView(planShelter, panelLayout(8));
        planPlanks = actionButton("Plan plank crafting (no crafting)", false, this::requestPlankCraftPlan);
        planPlanks.setVisibility(View.GONE);
        body.addView(planPlanks, panelLayout(8));
        planFarm = actionButton("Preview farming workflow", false,
                () -> requestGameplay("plan_workflow", false, null, "farm_preview", 0));
        planFarm.setVisibility(View.GONE);
        body.addView(planFarm, panelLayout(8));
        planStorage = actionButton("Preview storage workflow", false,
                () -> requestGameplay("plan_workflow", false, null, "storage_preview", 0));
        planStorage.setVisibility(View.GONE);
        body.addView(planStorage, panelLayout(8));
        advisorMode = actionButton("Enable suggestions-only companion advisor", false,
                () -> requestGameplay("advisor_mode", false, null, "suggestions", 0));
        advisorMode.setVisibility(View.GONE);
        body.addView(advisorMode, panelLayout(8));
        advisorReview = actionButton("Review companion's suggested next step", false,
                () -> requestGameplay("advisor_review", false));
        advisorReview.setVisibility(View.GONE);
        body.addView(advisorReview, panelLayout(8));

        section("Movement and autonomy controls");
        stopMovement = actionButton("Stop movement", false, () -> requestGameplay("stop_movement", false));
        stopMovement.setVisibility(View.GONE);
        body.addView(stopMovement, panelLayout(8));
        autoFollow = actionButton("Start bounded autonomous Follow/Return", false,
                this::showAutonomyConfirmation);
        autoFollow.setVisibility(View.GONE);
        body.addView(autoFollow, panelLayout(8));
        autoStop = actionButton("Stop autonomous Follow", false,
                () -> requestGameplay("autonomy_stop", false));
        autoStop.setVisibility(View.GONE);
        body.addView(autoStop, panelLayout(8));
        gameplayAgentStart = actionButton("Start Intelligent Gameplay (experimental)", true,
                this::chooseIntelligentGameplayGoal);
        gameplayAgentStart.setVisibility(View.GONE);
        body.addView(gameplayAgentStart, panelLayout(8));
        gameplayAgentStop = actionButton("Stop Intelligent Gameplay", false,
                () -> requestGameplay("agent_stop", false));
        gameplayAgentStop.setVisibility(View.GONE);
        body.addView(gameplayAgentStop, panelLayout(8));
        experimentalBreak = actionButton("Experimental break one observed block", false,
                this::showBlockBreakDialog);
        experimentalBreak.setVisibility(View.GONE);
        body.addView(experimentalBreak, panelLayout(8));

        stopWorld = actionButton("Disconnect bot", false, this::requestWorldStop);
        stopWorld.setTextColor(AMBER);
        stopWorld.setVisibility(View.GONE);
        body.addView(stopWorld, panelLayout(9));
        joinFriend = actionButton(signedIn ? "Browse friends" : "Sign in with Microsoft", true,
                () -> { if (signedIn) show("Xbox"); else openBotFlow(null, false); });
        body.addView(joinFriend, panelLayout(9));
        section("Latest activity");
        LinearLayout activity = card();
        lastEvent = text("", 14, INK, false);
        activity.addView(lastEvent);
        body.addView(activity, panelLayout(9));
        button("Open activity", () -> show("Logs"));
        refreshCommandCenter();
    }

    private void addImmediateRespawnButton(LinearLayout parent) {
        immediateRespawnButton = actionButton("Immediate Respawn", true,
                () -> requestGameplay("immediate_respawn", false));
        immediateRespawnButton.setVisibility(View.GONE);
        LinearLayout.LayoutParams params = panelLayout(0);
        params.topMargin = dp(10);
        parent.addView(immediateRespawnButton, params);
    }

    private TextView addVital(LinearLayout row, String title, int gap) {
        LinearLayout tile = card();
        tile.addView(text(title, 13, MUTED, true));
        TextView value = text("—", 23, INK, true);
        tile.addView(value);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, -1, 1);
        params.setMarginEnd(dp(gap));
        row.addView(tile, params);
        return value;
    }

    private void showSkills() {
        SkillsScreen.render(this, body);
    }



    private Bundle worldRequest(String method, String sessionId) {
        return worldRequest(method, sessionId, null);
    }

    private Bundle worldRequest(String method, String sessionId, Bundle extras) {
        try {
            return getContentResolver().call(Uri.parse("content://" + getPackageName() + ".world-session"),
                    method, sessionId, extras);
        } catch (IllegalArgumentException | IllegalStateException | SecurityException unavailable) {
            return null;
        }
    }

    private void refreshCommandCenter() {
        if (!dashboardVisible || (!"World".equals(currentTab) && !"Manual".equals(currentTab))) return;
        int generation = worldViewGeneration;
        worldReader.execute(() -> {
            Bundle current = worldRuntimeAvailable ? worldRequest("status", null) : null;
            var events = RuntimeLog.recent(this);
            String latest = events.isEmpty() ? "No session events yet" : RuntimeLog.describe(events.getLast());
            runOnUiThread(() -> {
                if (generation != worldViewGeneration || !dashboardVisible) return;
                Bundle snapshot = current == null ? Bundle.EMPTY : current;
                if ("Manual".equals(currentTab)) showManualControlStatus(snapshot);
                else showWorldStatus(snapshot);
                if (lastEvent != null) lastEvent.setText(latest);
                if (worldRuntimeAvailable) logRefresh.postDelayed(pollWorld, 1000);
            });
        });
    }

    private void showManualControlStatus(Bundle current) {
        String phase = current.getString("phase", "");
        worldSessionId = current.getString("session_id", "");
        boolean playing = "spawned".equals(phase);
        boolean dead = WorldSessionStatus.isDead(
                current.getString("life_state", ""), current.getString("assessment", ""));
        boolean connectedAndAlive = playing && !dead && !worldSessionId.isEmpty();
        if (immediateRespawnButton != null)
            immediateRespawnButton.setVisibility(dead ? View.VISIBLE : View.GONE);
        manualMovementReady = playing && current.getBoolean("movement_ready", false);
        // Keep touch input responsive while terrain is loading. The runtime still
        // enforces server-authority, collision and survival gates before moving.
        manualControlsEnabled = connectedAndAlive;
        if (manualControlPanel != null) manualControlPanel.setControlEnabled(connectedAndAlive);
        if (!connectedAndAlive) stopManualControl();
        if (manualMovementReady) manualQueueNoticeShown = false;

        if (worldState != null) {
            worldState.setText(dead ? "Bot is waiting to respawn" :
                    playing ? "In your friend's world" :
                    "connecting".equals(phase) ? "Connecting to world" : "Bot on standby");
            worldState.setTextColor(playing && !dead ? GRASS : INK);
        }
        if (worldDetail != null) {
            worldDetail.setText(playing
                    ? (dead ? "Death detected · automatic respawn recovery is active" :
                        "Connected · " + android.text.format.DateUtils.formatElapsedTime(current.getLong("seconds")) +
                        " · " + current.getLong("chunks") + " chunks")
                    : "connecting".equals(phase) ? "Waiting for the Minecraft session" : "No active connection");
        }
        if (worldHealth != null) worldHealth.setText(current.getString("health", "—"));
        if (worldHunger != null) worldHunger.setText(current.getString("hunger", "—"));
        if (healthMonitor != null) healthMonitor.update(current, worldRuntimeAvailable);

        if (manualControlStatus != null) {
            String capability = current.getString("movement_capability", "unavailable");
            String reason = current.getString("movement_last_reason", "");
            String terrainGate = current.getString("movement_terrain_gate", "");
            String inputState = current.getString("movement_input_state", "");
            String inputReason = current.getString("movement_input_reason", "");
            String message;
            if (!playing) {
                message = "Join a friend-hosted world to activate the controls.";
            } else if (dead) {
                message = "Controls pause while the bot is dead. MinePilot is handling respawn automatically.";
            } else if (manualMovementReady) {
                message = "Connected · movement physics and observed terrain are ready.";
            } else {
                message = "Connected · touch controls are active. Movement will start when server authority, physics and terrain are ready." +
                        "\nCurrent capability: " + capability.replace('_', ' ');
            }
            if (!manualMovementReady) {
                String gate = !terrainGate.isEmpty() ? terrainGate : reason;
                if (!gate.isEmpty()) message += "\nMovement gate: " + gate.replace('_', ' ');
                message += "\nTerrain: " + current.getInt("movement_decoded_sections", 0) +
                        " sections · " + current.getInt("movement_subchunk_response_successes", 0) +
                        " responses · " + current.getInt("movement_decode_errors", 0) + " decode errors";
                String unknown = current.getString("movement_unknown_reason", "");
                if (!unknown.isEmpty()) message += "\nUnknown block: " + unknown.replace('_', ' ');
            }
            if (current.getBoolean("movement_input_active", false) && !manualMovementReady) {
                message += "\nLocal input: " + (inputState.isEmpty() ? "waiting" : inputState.replace('_', ' '));
                if (!inputReason.isEmpty()) message += " · " + inputReason.replace('_', ' ');
            }
            String movementPresence = current.getString("movement_presence_state", "");
            if (!movementPresence.isEmpty()) {
                message += "\nMovement engine: " + movementPresence.replace('_', ' ');
                if ("waiting".equals(movementPresence)) {
                    String presenceReason = current.getString("movement_presence_reason", "");
                    if (!presenceReason.isEmpty())
                        message += " · " + presenceReason.replace('_', ' ');
                    message += " (retrying)";
                }
            }
            String runtimeCapability = current.getString("runtime_capability_state", "");
            if (!runtimeCapability.isEmpty())
                message += "\nSystem capability assessment: " + runtimeCapability.replace('_', ' ');
            String[] missingCapabilities = current.getStringArray("runtime_capability_missing");
            if (missingCapabilities != null && missingCapabilities.length > 0)
                message += "\nNot ready for task execution: " + String.join(", ", missingCapabilities).replace('_', ' ');
            int queuedFrames = current.getInt("movement_frames", 0);
            if (queuedFrames > 0) {
                String inputFlags = current.getString("movement_last_input_flags", "");
                message += "\nInput frames queued: " + queuedFrames;
                if (!inputFlags.isEmpty()) message += " · last flags: " + inputFlags.replace('_', ' ');
            }
            if (current.getBoolean("movement_stuck_suspected", false)) {
                String stuckReason = current.getString("movement_stuck_reason", "movement_input_without_server_progress");
                message += "\nPossible stuck state: " + stuckReason.replace('_', ' ') +
                        " · stop/reorient/repath suggested; no automatic movement issued.";
            }
            String lastStatus = current.getString("last_command_status", "");
            String lastReason = current.getString("last_command_reason", "");
            if ("rejected".equals(lastStatus) && !lastReason.isEmpty() && connectedAndAlive) {
                message += "\nLast command: " + lastReason.replace('_', ' ');
            }
            manualControlStatus.setText(message);
        }
    }

    private void addManualControlPanel() {
        manualControlPanel = new ManualControlPanel(this, new ManualControlPanel.Listener() {
            @Override public void onVectorChanged(float strafe, float forward) {
                onManualJoystickVector(strafe, forward);
            }
            @Override public void onActionChanged(String mode, boolean pressed) {
                setManualAction(mode, pressed);
            }
            @Override public void onLookChanged(String mode, boolean pressed) {
                setManualLookAction(mode, pressed);
            }
            @Override public void onStop() { stopManualControl(); }
            @Override public void onUnavailable() {
                showStatus("Movement is unavailable until the world and collision data are ready.");
            }
        });
        manualControlPanel.setControlEnabled(manualControlsEnabled);
        body.addView(manualControlPanel, panelLayout(10));
    }





    private void onManualJoystickVector(float strafe, float forward) {
        manualJoystickX = Math.max(-1f, Math.min(1f, strafe));
        manualJoystickY = Math.max(-1f, Math.min(1f, forward));
        boolean moving = Math.hypot(manualJoystickX, manualJoystickY) >= 0.12;
        if (!manualControlsEnabled || worldSessionId.isEmpty()) {
            stopManualControl();
            if (moving) showStatus("Movement is unavailable until the world and collision data are ready.");
            return;
        }
        if (!moving && !manualJump && !manualSprint && !manualSneak && manualLookMode.isEmpty()) {
            if (!activeManualMode.isEmpty()) stopManualControl();
            return;
        }
        String nextMode = manualLookMode.isEmpty() ? "vector" : manualLookMode;
        boolean startPulse = !nextMode.equals(activeManualMode);
        activeManualMode = nextMode;
        if (startPulse) {
            sendManualMotionPulse(nextMode);
            manualControlHandler.removeCallbacks(repeatManualControl);
            manualControlHandler.postDelayed(repeatManualControl, 450);
        }
    }

    private void setManualLookAction(String mode, boolean pressed) {
        if (!manualControlsEnabled || worldSessionId.isEmpty()) {
            stopManualControl();
            return;
        }
        if (pressed) {
            manualLookMode = mode;
            activeManualMode = mode;
            sendManualMotionPulse(mode);
            manualControlHandler.removeCallbacks(repeatManualControl);
            manualControlHandler.postDelayed(repeatManualControl, 450);
            return;
        }
        if (!mode.equals(manualLookMode)) return;
        manualLookMode = "";
        if (Math.hypot(manualJoystickX, manualJoystickY) >= 0.12 ||
                manualJump || manualSprint || manualSneak) {
            activeManualMode = "vector";
            sendManualMotionPulse("vector");
        } else {
            stopManualControl();
        }
    }

    private void setManualAction(String mode, boolean pressed) {
        if (!manualControlsEnabled || worldSessionId.isEmpty()) {
            stopManualControl();
            return;
        }
        switch (mode) {
            case "jump" -> manualJump = pressed;
            case "sprint" -> manualSprint = pressed;
            case "sneak" -> manualSneak = pressed;
            default -> { return; }
        }
        boolean active = Math.hypot(manualJoystickX, manualJoystickY) >= 0.12 ||
                manualJump || manualSprint || manualSneak || !manualLookMode.isEmpty();
        if (!active) {
            stopManualControl();
            return;
        }
        activeManualMode = manualLookMode.isEmpty() ? "vector" : manualLookMode;
        sendManualMotionPulse(activeManualMode);
        manualControlHandler.removeCallbacks(repeatManualControl);
        manualControlHandler.postDelayed(repeatManualControl, 450);
    }



    private void sendManualMotionPulse(String mode) {
        String session = worldSessionId;
        if (session.isEmpty() || !manualControlsEnabled) return;
        int generation = manualControlGeneration;
        Bundle extras = new Bundle();
        extras.putString("action", "manual_move");
        extras.putBoolean("confirmed", true);
        boolean hasAnalog = Math.hypot(manualJoystickX, manualJoystickY) >= 0.12 ||
                manualJump || manualSprint || manualSneak;
        boolean lookControl = mode.startsWith("turn_") || mode.startsWith("look_");
        String effectiveMode = hasAnalog && !lookControl ? "vector" : mode;
        extras.putString("motion_mode", effectiveMode);
        extras.putFloat("motion_x", manualJoystickX);
        extras.putFloat("motion_y", manualJoystickY);
        extras.putBoolean("jump", manualJump);
        extras.putBoolean("sprint", manualSprint);
        extras.putBoolean("sneak", manualSneak);
        extras.putInt("motion_ticks", 8);
        worldReader.execute(() -> {
            Bundle receipt = worldRequest("gameplay", session, extras);
            if (receipt == null || !receipt.getBoolean("accepted")) {
                runOnUiThread(() -> {
                    if (generation == manualControlGeneration && !activeManualMode.isEmpty() &&
                            !manualQueueNoticeShown) {
                        manualQueueNoticeShown = true;
                        showStatus("The game movement engine has not accepted this input yet. The command is sent directly; keep holding to retry while terrain and physics are checked.");
                    }
                });
            } else {
                runOnUiThread(() -> {
                    if (generation == manualControlGeneration) manualQueueNoticeShown = false;
                });
            }
        });
    }

    private void sendManualRelease() {
        String session = worldSessionId;
        if (session.isEmpty()) return;
        Bundle extras = new Bundle();
        extras.putString("action", "manual_stop");
        worldReader.execute(() -> worldRequest("gameplay", session, extras));
    }

    private void stopManualControl() {
        manualControlGeneration++;
        manualQueueNoticeShown = false;
        manualControlHandler.removeCallbacks(repeatManualControl);
        boolean wasMoving = !activeManualMode.isEmpty();
        activeManualMode = "";
        manualJoystickX = 0f;
        manualJoystickY = 0f;
        manualJump = false;
        manualSprint = false;
        manualSneak = false;
        manualLookMode = "";
        if (wasMoving) sendManualRelease();
    }

    private void showWorldStatus(Bundle current) {
        String phase = current.getString("phase", "");
        worldSessionId = current.getString("session_id", "");
        boolean playing = "spawned".equals(phase);
        boolean dead = WorldSessionStatus.isDead(
                current.getString("life_state", ""), current.getString("assessment", ""));
        boolean movementReady = playing && current.getBoolean("movement_ready", false);
        boolean connectedAndAlive = playing && !dead && !worldSessionId.isEmpty();
        if (immediateRespawnButton != null)
            immediateRespawnButton.setVisibility(dead ? View.VISIBLE : View.GONE);
        manualMovementReady = movementReady;
        manualControlsEnabled = connectedAndAlive;
        if (manualControlPanel != null) manualControlPanel.setControlEnabled(connectedAndAlive);
        if (!connectedAndAlive) stopManualControl();
        boolean canStop = (playing || "connecting".equals(phase)) && !worldSessionId.isEmpty();
        String assessment = switch (current.getString("assessment", "")) {
            case "dead" -> "Bot is down";
            case "recover_health" -> "Health is low";
            case "needs_food" -> "Food is needed";
            case "ready" -> "Vitals stable";
            default -> "Waiting for vitals";
        };
        worldState.setText(switch (phase) {
            case "spawned" -> "In your friend’s world";
            case "connecting" -> "Connecting to world";
            case "stopping" -> "Disconnecting";
            default -> "Bot on standby";
        });
        worldState.setTextColor(playing ? GRASS : INK);
        worldDetail.setText(playing
                ? assessment + " · " + android.text.format.DateUtils.formatElapsedTime(current.getLong("seconds"))
                        + " connected · " + current.getLong("chunks") + " chunks"
                : switch (phase) {
                    case "connecting" -> "Waiting for the Minecraft session";
                    case "stopping" -> "Finishing the world session";
                    default -> "No active connection";
                });
        worldHealth.setText(current.getString("health", "—"));
        worldHunger.setText(current.getString("hunger", "—"));
        if (healthMonitor != null) healthMonitor.update(current, worldRuntimeAvailable);
        if (lifeAnalytics != null) lifeAnalytics.update(current);
        if (firstPersonView != null) firstPersonView.update(current);
        if (gameplayAgentState != null) {
            boolean active = playing && current.getBoolean("agent_active", false);
            String phaseName=current.getString("agent_phase", "idle").replace('_',' ');
            gameplayAgentState.setText(active ? "GAMEPLAY ENGINE ACTIVE  ·  " + phaseName
                + "\nGoal: " + current.getString("agent_goal", "unknown").replace('_',' ')
                + "\nAttempted: " + current.getInt("agent_attempted")
                + " · Server-verified: " + current.getInt("agent_verified")
                + " · Failures: " + current.getInt("agent_failures")
                + "\nVerified drop pickups: " + current.getInt("agent_collected")
                + "\nStatus: " + current.getString("agent_reason", "waiting").replace('_',' ')
                : "Gameplay agent inactive · " + current.getString("agent_reason", "ready").replace('_',' '));
            if (playing && current.containsKey("gameplay_skill_ready")) {
                gameplayAgentState.append("\nCapabilities: "
                        + current.getInt("gameplay_skill_ready") + " available/experimental · "
                        + current.getInt("gameplay_skill_limited") + " limited · "
                        + current.getInt("gameplay_skill_unsupported") + " unsupported");
            }
        }
        learningNextTaskId = current.getString("learning_next_task_id", "");
        boolean learningActive = playing && current.getBoolean("learning_active", false);
        learningAutopilotEnabled = playing && current.getBoolean("learning_autopilot_enabled", false);
        if (learningState != null) {
            if (!playing) {
                learningState.setText("Connect to a Bedrock world to load reusable skills and curriculum.");
            } else if (learningActive) {
                learningState.setText("RUNNING · " + current.getString("learning_active_title", "Learning task")
                        + "\nGoal: " + current.getString("learning_active_goal", "unknown").replace('_', ' ')
                        + " · Phase: " + current.getString("learning_active_phase", "starting").replace('_', ' ')
                        + "\nServer-verified steps: " + current.getInt("learning_active_verified")
                        + "\nStatus: " + current.getString("learning_active_reason", "running").replace('_', ' '));
            } else if (!learningNextTaskId.isEmpty()) {
                learningState.setText("Recommended next task · " + current.getString("learning_next_task_title", learningNextTaskId)
                        + "\nGoal: " + current.getString("learning_next_task_goal", "unknown").replace('_', ' ')
                        + "\nMastered skills: " + current.getInt("learning_learned")
                        + " · Verified navigation steps: " + current.getInt("learning_verified_total")
                        + "\nProposals awaiting review: " + current.getInt("learning_proposed"));
            } else {
                learningState.setText("No currently eligible learning task. Mastered skills: "
                        + current.getInt("learning_learned")
                        + " · Verified navigation steps: " + current.getInt("learning_verified_total")
                        + "\nLast result: " + current.getString("learning_last_outcome", "none")
                        .replace('_', ' ') + " · " + current.getString("learning_last_reason", "no recent run")
                        .replace('_', ' '));
            }
        }
        if (learningState != null && playing) {
            String autopilotReason = current.getString("learning_autopilot_reason", "disabled");
            if (learningAutopilotEnabled && !learningActive) {
                learningState.setText("AUTOPILOT ARMED · Waiting for a supported task"
                        + "\nStatus: " + autopilotReason.replace('_', ' ')
                        + "\nRemaining tasks: " + current.getInt("learning_remaining_tasks")
                        + " · Blocked by prerequisites: " + current.getInt("learning_blocked_tasks"));
                String blocker = current.getString("learning_first_blocker", "");
                String blockedTask = current.getString("learning_first_blocked_task", "");
                if (!blocker.isEmpty()) {
                    learningState.append("\nFirst blocker: " + blocker.replace('_', ' ')
                            + (blockedTask.isEmpty() ? "" : " (" + blockedTask.replace('_', ' ') + ")"));
                }
            } else if (learningAutopilotEnabled) {
                learningState.append("\nAutopilot: running the local curriculum");
            } else if (!"disabled".equals(autopilotReason) && !learningActive) {
                learningState.append("\nAutopilot: " + autopilotReason.replace('_', ' '));
            }
            learningState.append("\nODYSSEY library: " + current.getInt("odyssey_total")
                    + " skills · " + current.getInt("odyssey_ready") + " ready · "
                    + current.getInt("odyssey_partial") + " partial · "
                    + current.getInt("odyssey_manual") + " manual · "
                    + current.getInt("odyssey_blocked") + " blocked");
        }
        if (learningStart != null) learningStart.setVisibility(
                playing && !learningActive && !learningNextTaskId.isEmpty() ? View.VISIBLE : View.GONE);
        if (learningStop != null) learningStop.setVisibility(
                learningActive ? View.VISIBLE : View.GONE);
        if (learningAutopilot != null) {
            learningAutopilot.setVisibility(playing ? View.VISIBLE : View.GONE);
            learningAutopilot.setText(learningAutopilotEnabled
                    ? "Stop local autopilot" : "Enable local autopilot");
        }
        if (brainStatus != null) {
            if (!playing || !current.getBoolean("brain_available", false)) {
                brainStatus.setText("Awaiting authenticated world telemetry");
            } else {
                String priority = current.getString("brain_action", "observe").replace('_', ' ');
                String reason = current.getString("brain_reason", "awaiting_observation").replace('_', ' ');
                brainStatus.setText("Current decision: " + priority
                    + "\nWhy: " + reason
                    + " · Urgency: " + current.getInt("brain_priority") + "/100"
                    + "\nSelected goal: " + current.getString("brain_goal", "standby").replace('_', ' ')
                    + "\nVisited areas remembered: " + current.getInt("brain_memory_cells")
                    + " · Decisions: " + current.getInt("brain_decisions")
                    + "\nPosition: " + ("server_fresh".equals(current.getString("brain_position_mode", "stale"))
                        ? "server-confirmed"
                        : "idle_spawn_anchor".equals(current.getString("brain_position_mode", "stale"))
                            ? "idle spawn anchor · no movement confirmed"
                            : current.getBoolean("brain_position_usable", false)
                                ? "usable" : "stale · waiting for server position")
                    + " · Verified movement steps: " + current.getInt("brain_verified_steps")
                    + "\nMode: suggestions + emergency movement stop; no automatic combat or mining");
            }
        }
        String coordinates = current.getString("position", "");
        String movement = current.getString("movement", "unavailable");
        String effectiveMode = current.getString("effective_gamemode", "unknown");
        String movementAuthority = current.getString("movement_authority", "unknown");
        String movementAuthoritySource = current.getString("movement_authority_source", "unknown");
        String command = current.getString("last_command", "");
        String task = current.getString("gameplay_task", "");
        String taskState = current.getString("gameplay_task_state", "");
        String movementOwner = current.getString("movement_owner", "");
        boolean inventoryKnown = current.getBoolean("inventory_known", false);
        String visibleNames = current.getString("visible_player_names", "");
        String followState = current.getString("follow_state", "");
        String followGoal = current.getString("follow_goal", "");
        String followReason = current.getString("follow_reason", "");
        String followTarget = current.getString("follow_player", "");
        String followHeading = current.getString("follow_heading", "");
        String followDistance = current.getString("follow_distance", "");
        String resourceStatus = current.getString("resource_state", "");
        String resourceReason = current.getString("resource_reason", "");
        String nearbyResources = current.getString("resource_nearby_items", "");
        String resourceTarget = current.getString("resource_target_name", "");
        int resourceRequested = current.getInt("resource_requested", 0);
        int resourceObserved = current.getInt("resource_observed", 0);
        String resourceDistance = current.getString("resource_distance", "");
        String survivalLevel = current.getString("survival_level", "unknown");
        String survivalReason = current.getString("survival_reason", "");
        String survivalTask = current.getString("survival_task_status", "");
        String survivalFoods = current.getString("survival_foods", "");
        String survivalFoodPlan = current.getString("survival_food_plan", "");
        String buildKind = current.getString("build_kind", "none");
        String buildState = current.getString("build_state", "");
        String buildMaterial = current.getString("build_material", "");
        String buildReason = current.getString("build_reason", "");
        String workflowKind = current.getString("workflow_kind", "none");
        String workflowState = current.getString("workflow_state", "");
        String workflowNext = current.getString("workflow_next", "");
        String addonNavOwner = current.getString("addon_nav_owner", "none");
        String terrainStatus = current.getString("terrain_route_status", "");
        String terrainReason = current.getString("terrain_route_reason", "");
        boolean autonomyActive = current.getBoolean("autonomy_active", false);
        boolean gameplayAgentActive = current.getBoolean("agent_active",false);
        String addonNavState = current.getString("addon_nav_state", "idle");
        String addonNavReason = current.getString("addon_nav_reason", "");
        String advisorModeText = current.getString("advisor_mode", "off");
        String advisorAction = current.getString("advisor_action", "none");
        String advisorReason = current.getString("advisor_reason", "");
        String advisorState = current.getString("advisor_state", "");
        String betaStage = current.getString("beta_stage", "");
        String betaBlockers = current.getString("beta_blockers", "");
        String betaPlanReason = current.getString("beta_plan_reason", "");
        String inventory = inventoryKnown
                ? current.getInt("inventory_occupied") + "/" + current.getInt("inventory_slots") + " occupied slots"
                : "inventory not observed";
        gameplayStatus.setText(coordinates.isEmpty() ? "Awaiting server position and chunks"
                : "Position: " + coordinates + " · Nearby players: " + current.getInt("nearby_players")
                        + " · Corrections: " + current.getInt("corrections")
                        + "\nMovement: " + movement
                        + "\nServer game mode: " + effectiveMode
                        + " · Difficulty: " + (current.containsKey("world_difficulty")
                            ? String.valueOf(current.getInt("world_difficulty")) : "unknown")
                        + "\nMovement authority: " + movementAuthority + " (" + movementAuthoritySource + ")"
                        + "\nLoading handshake: "
                        + (current.getBoolean("spawn_loading_completed", false) ? "sent" : "not confirmed")
                        + " · Respawn acks: " + current.getInt("spawn_respawn_acks")
                        + " · Errors: " + current.getInt("spawn_handshake_errors")
                        + "\nInventory: " + inventory
                        + "\nPhysics movement: " + (movementReady ? "ready" : "waiting for server / terrain")
                        + " · Frames: " + current.getInt("movement_frames")
                        + " · Server corrections: " + current.getInt("movement_corrections")
                        + " · Correction pending: " + current.getBoolean("movement_unconfirmed", false)
                        + " (server sends corrections when prediction differs)"
                        + "\nCollision data: " + current.getInt("movement_physics_blocks") + " blocks / "
                        + current.getInt("movement_physics_states") + " states"
                        + " · Terrain: " + (current.getBoolean("movement_terrain_ready", false) ? "observed" : "incomplete")
                        + " · Queries: " + current.getInt("movement_terrain_queries")
                        + (current.getString("movement_last_reason", "").isEmpty() ? "" :
                            "\nMovement status: " + current.getString("movement_last_status", "unknown").replace('_', ' ')
                            + " · " + current.getString("movement_last_reason").replace('_', ' '))
                        + (current.getString("movement_unknown_position", "").isEmpty() ? "" :
                            "\nMissing collision cell: " + current.getString("movement_unknown_position")
                            + " · " + current.getString("movement_unknown_reason", "terrain unknown").replace('_', ' '))
                        + (betaStage.isEmpty() ? "" :
                            "\nGameplay beta: " + betaStage
                            + (current.getBoolean("beta_ready", false) ? " · ready" : " · not device-verified")
                            + (betaPlanReason.isEmpty() ? "" : "\nPlanning gate: " + betaPlanReason)
                            + (betaBlockers.isEmpty() ? "" : "\nMissing verification: " + betaBlockers))
                        + "\nDecoded sections: " + current.getInt("terrain_sections")
                        + " · Registry ready: " + current.getBoolean("terrain_registry_ready", false)
                        + " · Decode errors: " + current.getInt("terrain_decode_errors")
                        + "\nSubchunk requests: " + current.getInt("subchunk_requests_sent")
                        + " · Request errors: " + current.getInt("subchunk_request_errors")
                        + "\\nBlock ID mode: " + (current.getBoolean("block_network_ids_are_hashes", false)
                            ? "hashed (hash resolver needed)"
                            : current.getInt("server_custom_block_properties", 0) > 0
                                ? "numeric + custom IDs unknown" : "vanilla numeric")
                        + (terrainStatus.isEmpty() ? "" : "\nVerified route: " + terrainStatus
                            + " · " + terrainReason + " · " + current.getInt("terrain_route_length") + " cells")
                        + "\nAutonomous Follow: " + (autonomyActive ? "active" : "stopped")
                        + " · Attempted: " + current.getInt("autonomy_attempted")
                        + " · Server-confirmed: " + current.getInt("autonomy_verified")
                        + " · Prediction-only: " + current.getInt("autonomy_predicted_steps")
                        + (current.getString("autonomy_reason", "").isEmpty() ? ""
                            : "\nAutonomy reason: " + current.getString("autonomy_reason"))
                        + "\nBlock action: " + current.getString("block_break_status", "idle")
                        + " · Frames: " + current.getInt("block_break_frames")
                        + " · Server block changed: " + current.getBoolean("block_break_changed", false)
                        + (current.getString("block_break_reason", "").isEmpty() ? ""
                            : "\nBlock action note: " + current.getString("block_break_reason"))
                        + "\nNavigation owner: " + addonNavOwner + " · " + addonNavState
                        + (addonNavReason.isEmpty() ? "" : "\nNavigation note: " + addonNavReason)
                        + "\nCompanion advisor: " + advisorModeText
                        + ("off".equals(advisorModeText) ? "" :
                            "\nSuggested next step (not executed): " + advisorAction
                            + " · " + advisorReason + " · " + advisorState
                            + "\nPrivate session observations: " + current.getInt("advisor_journal_count"))
                        + ("none".equals(workflowKind) ? "" :
                            "\nWorkflow preview: " + workflowKind + " · " + workflowState
                            + "\nReview step: " + current.getInt("workflow_checkpoint")
                                + "/" + current.getInt("workflow_total")
                            + (workflowNext.isEmpty() ? "" : " · " + workflowNext))
                        + "\nObserved storage windows: " + current.getInt("workflow_containers")
                        + " · Farm-region updates: " + current.getInt("workflow_updates")
                        + ("none".equals(buildKind) ? "" :
                            "\nBuild/craft proposal: " + buildKind + " · " + buildState
                            + (buildMaterial.isEmpty() ? "" : "\nMaterial: " + buildMaterial)
                            + "\nRequired: " + current.getInt("build_required")
                            + (current.containsKey("build_onhand") ? " · Owned: " + current.getInt("build_onhand") : "")
                            + (current.containsKey("build_missing") ? " · Missing: " + current.getInt("build_missing") : "")
                            + (current.containsKey("build_logs_needed") ? "\nPossible logs needed (unverified recipe): "
                                + current.getInt("build_logs_needed") : "")
                            + "\nPlan details: " + buildReason
                            + " · Block updates near plan: " + current.getInt("build_observed_updates"))
                        + "\nSurvival observation: " + survivalLevel
                        + (survivalReason.isEmpty() ? "" : " · " + survivalReason)
                        + (survivalTask.isEmpty() ? "" : "\nTask safety: " + survivalTask)
                        + (survivalFoods.isEmpty() ? "" : "\nObserved food: " + survivalFoods)
                        + (survivalFoodPlan.isEmpty() ? "" : "\nFood plan (not used): " + survivalFoodPlan)
                        + "\nDrop actors: " + current.getInt("resource_drops")
                        + " · Recent block updates: " + current.getInt("resource_blocks")
                        + " · Registered item types: " + current.getInt("resource_items")
                        + (nearbyResources.isEmpty() ? "" : "\nObserved items: " + nearbyResources)
                        + (resourceStatus.isEmpty() || "idle".equals(resourceStatus) ? "" :
                            "\nResource plan: " + resourceStatus
                            + (resourceTarget.isEmpty() ? "" : " (" + resourceTarget + ")")
                            + " · " + resourceReason
                            + (resourceRequested <= 0 ? "" : "\nServer-observed count: "
                                + resourceObserved + "/" + resourceRequested)
                            + (resourceDistance.isEmpty() ? "" : " · Distance " + resourceDistance))
                        + (visibleNames.isEmpty() ? "" : "\nObserved players: " + visibleNames)
                        + (followGoal.isEmpty() ? "" : "\nNavigation plan: " + followGoal + " · " + followState
                            + (followTarget.isEmpty() ? "" : " (" + followTarget + ")")
                            + "\nPlan status: " + followReason
                            + (followDistance.isEmpty() ? "" : " · Distance " + followDistance)
                            + (followHeading.isEmpty() ? "" : " · Heading " + followHeading + "°"))
                        + (current.getBoolean("home_known", false) ? "\nHome: saved for this world session" : "")
                        + (current.containsKey("equipment_slot") ? "\nHeld slot: " + current.getInt("equipment_slot") : "")
                        + (task.isEmpty() ? "" : "\nTask: " + task + " · " + taskState)
                        + (movementOwner.isEmpty() ? "" : "\nMovement owner: " + movementOwner)
                        + (current.getBoolean("safety_hold", false) ? "\nSurvival hold: critical health" : "")
                        + (command.isEmpty() ? "" : "\nLast command: " + command
                            + " · Runtime: " + current.getString("last_command_execution_stage", "awaiting receipt").replace('_', ' ')
                            + " · Dispatch accepted: " + current.getBoolean("last_command_dispatch_accepted", false)
                            + (current.getString("last_command_server_confirmation", "").isEmpty() ? "" :
                                " · Server: " + current.getString("last_command_server_confirmation").replace('_', ' '))));
        inspectWorld.setVisibility(playing ? View.VISIBLE : View.GONE);
        waitHere.setVisibility(playing ? View.VISIBLE : View.GONE);
        planFollow.setVisibility(playing ? View.VISIBLE : View.GONE);
        markHome.setVisibility(playing ? View.VISIBLE : View.GONE);
        planReturn.setVisibility(playing && current.getBoolean("home_known", false)
                ? View.VISIBLE : View.GONE);
        planCollect.setVisibility(playing ? View.VISIBLE : View.GONE);
        inspectUpdatedBlocks.setVisibility(playing ? View.VISIBLE : View.GONE);
        planFood.setVisibility(playing ? View.VISIBLE : View.GONE);
        planShelter.setVisibility(playing ? View.VISIBLE : View.GONE);
        planPlanks.setVisibility(playing ? View.VISIBLE : View.GONE);
        planFarm.setVisibility(playing ? View.VISIBLE : View.GONE);
        planStorage.setVisibility(playing ? View.VISIBLE : View.GONE);
        advisorMode.setVisibility(playing ? View.VISIBLE : View.GONE);
        advisorReview.setVisibility(playing && "suggestions".equals(advisorModeText)
                ? View.VISIBLE : View.GONE);
        advisorMode.setText("suggestions".equals(advisorModeText)
                ? "Disable companion suggestions" : "Enable companion suggestions (no actions)");
        advisorMode.setOnClickListener(view -> requestGameplay("advisor_mode", false,
                null, "suggestions".equals(advisorModeText) ? "off" : "suggestions", 0));
        stopMovement.setVisibility(playing ? View.VISIBLE : View.GONE);
        autoFollow.setVisibility(movementReady && !autonomyActive && !gameplayAgentActive
                ? View.VISIBLE : View.GONE);
        autoStop.setVisibility(playing && autonomyActive ? View.VISIBLE : View.GONE);
        gameplayAgentStart.setVisibility(movementReady &&
                current.getBoolean("terrain_registry_ready",false) &&
                !autonomyActive && !gameplayAgentActive ? View.VISIBLE : View.GONE);
        gameplayAgentStop.setVisibility(playing && gameplayAgentActive ? View.VISIBLE : View.GONE);
        experimentalBreak.setVisibility(movementReady &&
                current.getBoolean("terrain_registry_ready", false) && !autonomyActive && !gameplayAgentActive
                ? View.VISIBLE : View.GONE);
        stopWorld.setVisibility(canStop ? View.VISIBLE : View.GONE);
        stopWorld.setEnabled(canStop);
        joinFriend.setVisibility(playing || "connecting".equals(phase) || "stopping".equals(phase)
                ? View.GONE : View.VISIBLE);
    }

    private void requestFollowPlan() {
        EditText target = new EditText(this);
        target.setSingleLine(true);
        target.setHint("Exact observed gamertag");
        target.setTextColor(INK);
        target.setHintTextColor(MUTED);
        new android.app.AlertDialog.Builder(this)
                .setTitle("Follow player")
                .setMessage("Enter an exact observed gamertag. Follow is experimental: the bot will attempt short movement steps on verified terrain only, stopping if the host does not confirm progress.")
                .setView(target)
                .setNegativeButton("Cancel", null)
                .setNeutralButton("Plan only", (dialog, which) ->
                        requestGameplay("plan_follow", false, target.getText().toString().trim()))
                .setPositiveButton("Start Follow", (dialog, which) ->
                        requestGameplay("follow_player", true, target.getText().toString().trim()))
                .show();
    }

    private void showBlockBreakDialog() {
        EditText coordinate = new EditText(this);
        coordinate.setSingleLine(true);
        coordinate.setHint("x,y,z (observed block coordinates)");
        coordinate.setTextColor(INK);
        coordinate.setHintTextColor(MUTED);
        new android.app.AlertDialog.Builder(this)
                .setTitle("Experimental block break")
                .setMessage("Break one known solid block within 4.5 blocks. Only test in a private world with permission. This sends bounded Bedrock input; the host may reject it, and a block update is needed before the app reports a change.")
                .setView(coordinate)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Attempt break", (dialog, which) ->
                        requestGameplay("experimental_break", true,
                                coordinate.getText().toString().trim()))
                .show();
    }
    private void chooseIntelligentGameplayGoal() {
        final String[] goals = {"Automatic AI movement: choose safe actions and explore",
                "Survive: explore and collect observed drops",
                "Explore verified terrain", "Follow a player",
                "Return to marked home", "Collect an observed item drop"};
        final String[] ids = {"auto","survive","explore","follow","return_home","gather"};
        new android.app.AlertDialog.Builder(this)
                .setTitle("Gameplay Intelligence")
                .setMessage("Automatic AI movement chooses safe local exploration, avoids recognized nearby hostiles, and may approach server-observed item drops. It will pause instead of guessing when terrain, health, hunger or server confirmation is insufficient. No automatic combat, eating, mining or building.")
                .setItems(goals, (dialog, which) -> {
                    String goal=ids[which];
                    if ("follow".equals(goal)) {
                        EditText target = new EditText(this);
                        target.setSingleLine(true);
                        target.setHint("Exact observed player gamertag");
                        target.setTextColor(INK);
                        target.setHintTextColor(MUTED);
                        new android.app.AlertDialog.Builder(this)
                            .setTitle("Intelligent Follow")
                            .setMessage("Follow will only use a player you explicitly select. The bot stops if movement cannot be confirmed.")
                            .setView(target)
                            .setNegativeButton("Cancel",null)
                            .setPositiveButton("Start", (d,b)->requestGameplayAgent(goal,
                                    target.getText().toString().trim()))
                            .show();
                    } else {
                        new android.app.AlertDialog.Builder(this)
                            .setTitle("Start " + goals[which])
                            .setMessage("Runs a bounded local action loop with actual Bedrock movement. If terrain or server confirmation is unavailable, it will not guess.")
                            .setNegativeButton("Cancel",null)
                            .setPositiveButton("Start", (d,b)->requestGameplayAgent(goal,null))
                            .show();
                    }
                }).show();
    }

    private void requestGameplayAgent(String goal,String playerName) {
        String session=worldSessionId;
        if(session.isEmpty())return;
        Bundle extras=new Bundle();
        extras.putString("action","agent_start");
        extras.putBoolean("confirmed",true);
        extras.putString("agent_goal",goal);
        if(playerName!=null)extras.putString("player_name",playerName);
        int generation=worldViewGeneration;
        worldReader.execute(()->{
            Bundle receipt=worldRequest("gameplay",session,extras);
            runOnUiThread(()->{
                if(generation!=worldViewGeneration||!dashboardVisible)return;
                showStatus(receipt!=null&&receipt.getBoolean("accepted")
                        ?"Gameplay start queued. Check AI Brain for actual acceptance."
                        :"Gameplay agent could not be queued. Check the current world session.");
            });
        });
    }

    private void showAutonomyConfirmation() {
        new android.app.AlertDialog.Builder(this)
                .setTitle("Experimental autonomous Follow/Return")
                .setMessage("Only use in a safe private world. The bot attempts up to 20 short walking segments over 30 seconds, on verified terrain only, and stops if server movement is not confirmed. Start by selecting a Follow or Return goal. Unknown terrain, health danger and missing authority block movement.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Start bounded Follow", (dialog, which) ->
                        requestGameplay("autonomy_follow", true))
                .show();
    }

    private void requestCollectionPlan() {
        LinearLayout fields = new LinearLayout(this);
        fields.setOrientation(LinearLayout.VERTICAL);
        fields.setPadding(dp(16), dp(4), dp(16), dp(4));
        EditText item = new EditText(this);
        item.setSingleLine(true);
        item.setHint("minecraft:oak_log");
        item.setTextColor(INK);
        item.setHintTextColor(MUTED);
        fields.addView(item);
        EditText count = new EditText(this);
        count.setSingleLine(true);
        count.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        count.setHint("Item count (1–64)");
        count.setTextColor(INK);
        count.setHintTextColor(MUTED);
        fields.addView(count);
        new android.app.AlertDialog.Builder(this)
                .setTitle("Plan resource collection")
                .setMessage("Use an item name from the observed item registry. This creates a target plan, not automatic mining or pickup.")
                .setView(fields)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Plan only", (dialog, which) -> {
                    int requested;
                    try { requested = Integer.parseInt(count.getText().toString().trim()); }
                    catch (NumberFormatException invalid) {
                        showStatus("Enter a valid quantity from 1 to 64.");
                        return;
                    }
                    if (requested < 1 || requested > 64) {
                        showStatus("Quantity must be between 1 and 64.");
                        return;
                    }
                    requestGameplay("plan_collect", false, null,
                            item.getText().toString().trim(), requested);
                }).show();
    }

    private void requestShelterPlan() {
        EditText material = new EditText(this);
        material.setSingleLine(true);
        material.setText("minecraft:oak_planks");
        material.setHint("minecraft:oak_planks");
        material.setTextColor(INK);
        new android.app.AlertDialog.Builder(this)
                .setTitle("Plan a small wooden shelter")
                .setMessage("Creates a 3×3, two-high wall and roof blueprint with doorway. Terrain is not scanned; no blocks will be placed.")
                .setView(material)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Create plan only", (dialog, which) ->
                        requestGameplay("plan_shelter", false, null, material.getText().toString().trim(), 0))
                .show();
    }

    private void requestPlankCraftPlan() {
        LinearLayout fields = new LinearLayout(this);
        fields.setOrientation(LinearLayout.VERTICAL);
        EditText material = new EditText(this);
        material.setSingleLine(true);
        material.setText("minecraft:oak_planks");
        material.setTextColor(INK);
        fields.addView(material);
        EditText amount = new EditText(this);
        amount.setSingleLine(true);
        amount.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        amount.setHint("Plank count (1–256)");
        amount.setTextColor(INK);
        fields.addView(amount);
        new android.app.AlertDialog.Builder(this)
                .setTitle("Plan plank crafting")
                .setMessage("Estimates required logs based on inventory. It will not craft or change your items.")
                .setView(fields)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Plan only", (dialog, which) -> {
                    int count;
                    try { count = Integer.parseInt(amount.getText().toString().trim()); }
                    catch (NumberFormatException invalid) {
                        showStatus("Enter a plank count from 1 to 256.");
                        return;
                    }
                    if (count < 1 || count > 256) {
                        showStatus("Plank count must be 1 to 256.");
                        return;
                    }
                    requestGameplay("plan_craft_planks", false, null,
                            material.getText().toString().trim(), count);
                }).show();
    }

    private void requestGameplay(String action, boolean confirmed) {
        requestGameplay(action, confirmed, null);
    }

    private void requestGameplay(String action, boolean confirmed, String playerName) {
        requestGameplay(action, confirmed, playerName, null, 0);
    }

    private void toggleLocalAutopilot() {
        if (learningAutopilotEnabled) {
            requestGameplay("learning_autopilot_stop", false);
            return;
        }
        new android.app.AlertDialog.Builder(this)
                .setTitle("Enable local autopilot")
                .setMessage("MinePilot will run its built-in Bedrock tasks in sequence using deterministic local rules. No external AI prompt, cloud model or Kaggle GPU is required. It will only use currently supported, verified tasks; unknown terrain, unsafe vitals, failed server confirmation and run limits stop actions. Mining, combat, crafting and building are not enabled by this switch. You can stop autopilot at any time.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Enable", (dialog, which) ->
                        requestGameplay("learning_autopilot_start", true))
                .show();
    }

    private void confirmLearningStart() {
        String taskId = learningNextTaskId;
        if (taskId.isEmpty()) {
            showStatus("No learning task is currently eligible in this Bedrock world.");
            return;
        }
        String title = learningState == null ? taskId : learningState.getText().toString();
        new android.app.AlertDialog.Builder(this)
                .setTitle("Start MinePilot learning")
                .setMessage("Run the recommended, bounded Bedrock task?\n\n"
                        + title + "\n\nMinePilot uses its existing gameplay safety checks. "
                        + "The task stops on unsafe state, failed server confirmation or its run budget. "
                        + "You can stop it at any time. It will not execute generated code.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Start task", (dialog, which) ->
                        requestGameplay("learning_start", true, null, null, 0, taskId))
                .show();
    }

    private void requestGameplay(String action, boolean confirmed, String playerName,
                                 String itemName, int itemCount) {
        requestGameplay(action, confirmed, playerName, itemName, itemCount, null);
    }

    private void requestGameplay(String action, boolean confirmed, String playerName,
                                 String itemName, int itemCount, String taskId) {
        String session = worldSessionId;
        if (session.isEmpty()) return;
        Bundle extras = new Bundle();
        extras.putString("action", action);
        extras.putBoolean("confirmed", confirmed);
        if (playerName != null) {
            if ("experimental_break".equals(action))
                extras.putString("block_position", playerName);
            else extras.putString("player_name", playerName);
        }
        if (itemName != null) {
            extras.putString("item_name", itemName);
            extras.putInt("item_count", itemCount);
        }
        if (taskId != null) extras.putString("task_id", taskId);
        int generation = worldViewGeneration;
        worldReader.execute(() -> {
            Bundle receipt = worldRequest("gameplay", session, extras);
            runOnUiThread(() -> {
                if (generation != worldViewGeneration || !dashboardVisible) return;
                showStatus(receipt != null && receipt.getBoolean("accepted")
                        ? "Gameplay command queued. Check the server response below."
                        : "Gameplay request could not be queued for this session.");
            });
        });
    }

    private void requestWorldStop() {
        String session = worldSessionId;
        if (session.isEmpty()) return;
        stopWorld.setEnabled(false);
        int generation = worldViewGeneration;
        worldReader.execute(() -> {
            Bundle receipt = worldRequest("stop", session);
            runOnUiThread(() -> {
                if (generation != worldViewGeneration || !dashboardVisible) return;
                if (receipt == null || !receipt.getBoolean("accepted")) {
                    showStatus("The world session has ended or could not be stopped.");
                }
            });
        });
    }

    private void showRuntimeLogs(boolean signedIn) {
        hero("SESSION HISTORY", "Activity", "Inspect Xbox, world connection, and runtime events.");
        section("App status");
        label(signedIn ? "Xbox account connected" : "Xbox account disconnected", 14);
        latestRuntimeStatus = text("", 16, INK, true);
        body.addView(latestRuntimeStatus);
        section("Recent events");
        android.widget.Switch filter = new android.widget.Switch(this);
        filter.setText("Failures only");
        filter.setTextColor(INK);
        filter.setChecked(failuresOnly);
        filter.setPadding(dp(12), 0, dp(12), 0);
        filter.setMinimumHeight(dp(48));
        body.addView(filter, panelLayout(9));
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
        filter.setOnCheckedChangeListener((view, checked) -> {
            failuresOnly = checked;
            refreshRuntimeLogs();
        });
        updateLogs.run();
    }

    private void refreshRuntimeLogs() {
        var events = RuntimeLog.recent(this);
        String latest = events.isEmpty() ? "Ready" : RuntimeLog.describe(events.getLast());
        latestRuntimeStatus.setText("Latest status · " + latest);
        if (failuresOnly) events.removeIf(event -> switch (event.optString("phase")) {
            case "failed", "runtime_failed", "account_failed", "disconnected", "runtime_interrupted" -> false;
            default -> true;
        });
        String history = events.isEmpty() && failuresOnly ? "No failures in recent events." : formatRuntimeEvents(events);
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
