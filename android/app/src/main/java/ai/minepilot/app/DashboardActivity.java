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
    private Button probeStep;
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
    private static final int BG = 0xff0d121b;
    private static final int PANEL = 0xff171f2e;
    private static final int GRASS = 0xff65e4ad;
    private static final int INK = 0xffeef4ff;
    private static final int BORDER = 0xff303d52;
    private static final int MUTED = 0xffadb9cd;
    private static final int AMBER = 0xffffc07a;
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
        if ("Xbox".equals(currentTab) || "World".equals(currentTab)) show(currentTab);
        if ("Logs".equals(currentTab)) {
            logRefresh.removeCallbacks(updateLogs);
            updateLogs.run();
        }
    }

    @Override protected void onPause() {
        dashboardVisible = false;
        worldViewGeneration++;
        logRefresh.removeCallbacks(pollWorld);
        logRefresh.removeCallbacks(updateLogs);
        super.onPause();
    }

    @Override protected void onDestroy() {
        worldReader.shutdownNow();
        super.onDestroy();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String requestedTab = intent.getStringExtra("open_tab");
        if ("World".equals(requestedTab) || "Xbox".equals(requestedTab) || "Logs".equals(requestedTab)) show(requestedTab);
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
        logRefresh.removeCallbacks(updateLogs);
        logRefresh.removeCallbacks(pollWorld);
        worldViewGeneration++;
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
        for (String page : new String[]{"World", "Xbox", "Skills", "Logs", "Settings"}) {
            boolean selected = page.equals(tab) || ("Settings".equals(page) && "Diagnostics".equals(tab));
            Button item = new Button(this);
            item.setText(switch (page) {
                case "World" -> "Control";
                case "Xbox" -> "Friends";
                case "Logs" -> "Activity";
                default -> page;
            });
            item.setAllCaps(false);
            item.setTextSize(12);
            item.setPadding(dp(2), 0, dp(2), 0);
            item.setTextColor(selected ? BG : MUTED);
            item.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            item.setSelected(selected);
            item.setBackground(new RippleDrawable(ColorStateList.valueOf(0x2673dab6),
                    surface(selected ? GRASS : PANEL, 10), null));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(48), 1);
            params.setMargins(dp(3), 0, dp(3), 0);
            nav.addView(item, params);
            item.setOnClickListener(view -> show(page));
        }
        root.addView(nav);
        setContentView(root);

        boolean signedIn = BotAccount.saved(this);
        switch (tab) {
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
        body.addView(session, panelLayout(10));

        LinearLayout vitals = new LinearLayout(this);
        worldHealth = addVital(vitals, "Health", 8);
        worldHunger = addVital(vitals, "Hunger", 0);
        body.addView(vitals, panelLayout(10));

        LinearLayout gameplay = card();
        gameplay.addView(text("GAMEPLAY TELEMETRY", 11, GRASS, true));
        gameplayStatus = text("Waiting for a server-reported position", 13, MUTED, false);
        gameplayStatus.setPadding(0, dp(5), 0, dp(6));
        gameplay.addView(gameplayStatus);
        body.addView(gameplay, panelLayout(10));
        inspectWorld = actionButton("Inspect bot status", false, () -> requestGameplay("inspect", false));
        inspectWorld.setVisibility(View.GONE);
        body.addView(inspectWorld, panelLayout(8));
        waitHere = actionButton("Stay here", false, () -> requestGameplay("stay", false));
        waitHere.setVisibility(View.GONE);
        body.addView(waitHere, panelLayout(8));
        section("Companion and planning previews");
        planFollow = actionButton("Plan follow player", false, this::requestFollowPlan);
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

        section("Stop and experimental connection controls");
        stopMovement = actionButton("Stop movement", false, () -> requestGameplay("stop_movement", false));
        stopMovement.setVisibility(View.GONE);
        body.addView(stopMovement, panelLayout(8));
        probeStep = actionButton("Experimental movement diagnostics", false, this::showMovementDiagnostics);
        probeStep.setVisibility(View.GONE);
        body.addView(probeStep, panelLayout(8));
        boolean experimentEnabled = getSharedPreferences("minepilot_gameplay", MODE_PRIVATE)
                .getBoolean("allow_experimental_movement", false);
        button(experimentEnabled ? "Disable movement probe for next join" : "Enable experimental movement for next join",
                () -> configureMovementProbe(!experimentEnabled));

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
        hero("BOT SKILLS", "Capabilities", "See the actions and observations available to your bot.");
        skillCard("Vitals awareness", "Available", GRASS,
                "Reads the bot’s health and hunger while connected and flags low vitals.");
        section("Planned skills");
        skillCard("Follow a player", "Planned", AMBER, "Track a selected player and maintain a follow distance.");
        skillCard("Resource observations", "Experimental", AMBER,
                "Read item registry, nearby drops and block updates; gathering remains planning-only.");
        skillCard("Survival priorities", "Experimental", AMBER,
                "Pause plans on critical vitals and suggest observed food; no automatic eating or combat.");
        skillCard("Craft and shelter plans", "Experimental", AMBER,
                "Estimate plank materials and preview a 23-block shelter; no crafting or placement yet.");
    }

    private void skillCard(String name, String availability, int color, String description) {
        LinearLayout card = card();
        card.addView(text(availability, 12, color, true));
        TextView title = text(name, 19, INK, true);
        title.setPadding(0, dp(4), 0, dp(4));
        card.addView(title);
        card.addView(text(description, 14, MUTED, false));
        body.addView(card, panelLayout(10));
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
        if (!dashboardVisible || !"World".equals(currentTab)) return;
        int generation = worldViewGeneration;
        worldReader.execute(() -> {
            Bundle current = worldRuntimeAvailable ? worldRequest("status", null) : null;
            var events = RuntimeLog.recent(this);
            String latest = events.isEmpty() ? "No session events yet" : RuntimeLog.describe(events.getLast());
            runOnUiThread(() -> {
                if (generation != worldViewGeneration || !dashboardVisible) return;
                showWorldStatus(current == null ? Bundle.EMPTY : current);
                lastEvent.setText(latest);
                if (worldRuntimeAvailable) logRefresh.postDelayed(pollWorld, 1000);
            });
        });
    }

    private void showWorldStatus(Bundle current) {
        String phase = current.getString("phase", "");
        worldSessionId = current.getString("session_id", "");
        boolean playing = "spawned".equals(phase);
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
        String addonNavState = current.getString("addon_nav_state", "idle");
        String addonNavReason = current.getString("addon_nav_reason", "");
        String advisorModeText = current.getString("advisor_mode", "off");
        String advisorAction = current.getString("advisor_action", "none");
        String advisorReason = current.getString("advisor_reason", "");
        String advisorState = current.getString("advisor_state", "");
        String betaStage = current.getString("beta_stage", "");
        String betaBlockers = current.getString("beta_blockers", "");
        String betaPlanReason = current.getString("beta_plan_reason", "");
        String motionMode = current.getString("motion_mode", "idle");
        String motionStopReason = current.getString("motion_stop_reason", "");
        String motionDisplacement = current.getString("motion_displacement", "");
        String motionDrift = current.getString("motion_drift", "");
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
                        + "\nMotion diagnostic: " + motionMode
                        + (current.getBoolean("motion_active", false) ? " · active" : " · idle")
                        + "\nNeutral presence: " + (current.getBoolean("presence_active", false) ? "active" : "stopped")
                        + " · Heartbeat frames: " + current.getInt("presence_frames")
                        + (current.getString("presence_error", "").isEmpty() ? "" : " · Error: " + current.getString("presence_error"))
                        + "\nInput frames sent: " + current.getInt("motion_frames")
                        + " · Server updates: " + current.getInt("motion_server_updates")
                        + " · Corrections: " + current.getInt("motion_corrections")
                        + (motionDisplacement.isEmpty() ? "" : "\nObserved displacement (not proof): " + motionDisplacement)
                        + (motionDrift.isEmpty() ? "" : " · Max drift: " + motionDrift)
                        + (motionStopReason.isEmpty() ? "" : "\nLast motion stop: " + motionStopReason)
                        + (betaStage.isEmpty() ? "" :
                            "\nGameplay beta: " + betaStage
                            + (current.getBoolean("beta_ready", false) ? " · ready" : " · not device-verified")
                            + (betaPlanReason.isEmpty() ? "" : "\nPlanning gate: " + betaPlanReason)
                            + (betaBlockers.isEmpty() ? "" : "\nMissing verification: " + betaBlockers))
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
                        + (command.isEmpty() ? "" : "\nLast command: " + command));
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
        probeStep.setVisibility(playing && "experimental".equals(movement) ? View.VISIBLE : View.GONE);
        stopWorld.setVisibility(canStop ? View.VISIBLE : View.GONE);
        stopWorld.setEnabled(canStop);
        joinFriend.setVisibility(playing || "connecting".equals(phase) || "stopping".equals(phase)
                ? View.GONE : View.VISIBLE);
    }

    private void configureMovementProbe(boolean enable) {
        if (!enable) {
            getSharedPreferences("minepilot_gameplay", MODE_PRIVATE).edit()
                    .putBoolean("allow_experimental_movement", false).commit();
            show("World");
            return;
        }
        new android.app.AlertDialog.Builder(this)
                .setTitle("Experimental Bedrock movement")
                .setMessage("Only enable this in a safe, consenting friend's test world. The movement codec and physics are not verified on your device. It will affect the next connection, and each probe still requires confirmation.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Enable for next join", (dialog, which) -> {
                    getSharedPreferences("minepilot_gameplay", MODE_PRIVATE).edit()
                            .putBoolean("allow_experimental_movement", true).commit();
                    show("World");
                }).show();
    }

    private void showMovementDiagnostics() {
        String[] modes = { "Forward — 6 ticks (0.3 s)",
                "Turn left — 6 ticks (0.3 s)", "Turn right — 6 ticks (0.3 s)",
                "Forward — 20 ticks (1 s)" };
        String[] codes = { "forward", "turn_left", "turn_right", "forward" };
        new android.app.AlertDialog.Builder(this)
                .setTitle("Experimental movement diagnostic")
                .setMessage("This only tests protocol input, not autonomous gameplay. In a private flat world it may move unexpectedly or disconnect. Server telemetry does not prove causality.")
                .setItems(modes, (dialog, selected) -> new android.app.AlertDialog.Builder(this)
                        .setTitle("Confirm experimental movement")
                        .setMessage("Run a bounded " + modes[selected] + " input sequence? Stop remains available.")
                        .setNegativeButton("Cancel", null)
                        .setPositiveButton("Run diagnostic", (confirm, which) ->
                                requestMotionDiagnostic(codes[selected], selected == 3 ? 20 : 6))
                        .show())
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void requestMotionDiagnostic(String mode, int ticks) {
        String session = worldSessionId;
        if (session.isEmpty()) return;
        Bundle extras = new Bundle();
        extras.putString("action", "motion_diagnostic");
        extras.putBoolean("confirmed", true);
        extras.putString("motion_mode", mode);
        extras.putInt("motion_ticks", ticks);
        int generation = worldViewGeneration;
        worldReader.execute(() -> {
            Bundle receipt = worldRequest("gameplay", session, extras);
            runOnUiThread(() -> {
                if (generation != worldViewGeneration || !dashboardVisible) return;
                showStatus(receipt != null && receipt.getBoolean("accepted")
                        ? "Diagnostic queued. Packet acceptance and movement are not yet verified."
                        : "Movement diagnostic unavailable for this session.");
            });
        });
    }

    private void confirmMovementProbe() {
        new android.app.AlertDialog.Builder(this)
                .setTitle("Run one short movement probe?")
                .setMessage("This sends up to six experimental Bedrock input ticks. It may fail, disconnect, or move unexpectedly. Test only on safe flat terrain. Queued packets do not prove the bot moved.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Run probe", (dialog, which) -> requestGameplay("probe_step", true))
                .show();
    }

    private void requestFollowPlan() {
        EditText target = new EditText(this);
        target.setSingleLine(true);
        target.setHint("Exact observed gamertag");
        target.setTextColor(INK);
        target.setHintTextColor(MUTED);
        new android.app.AlertDialog.Builder(this)
                .setTitle("Plan follow — no automatic movement")
                .setMessage("Enter the exact gamertag of a currently observed player. This makes a navigation plan but does not move the bot until real walking is verified.")
                .setView(target)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Plan follow", (dialog, which) ->
                        requestGameplay("plan_follow", false, target.getText().toString().trim()))
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

    private void requestGameplay(String action, boolean confirmed, String playerName,
                                 String itemName, int itemCount) {
        String session = worldSessionId;
        if (session.isEmpty()) return;
        Bundle extras = new Bundle();
        extras.putString("action", action);
        extras.putBoolean("confirmed", confirmed);
        if (playerName != null) extras.putString("player_name", playerName);
        if (itemName != null) {
            extras.putString("item_name", itemName);
            extras.putInt("item_count", itemCount);
        }
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
