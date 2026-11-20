package ai.minepilot.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
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
    private void label(String text, int size) {
        TextView v = new TextView(this);
        v.setText(text);
        v.setTextSize(size);
        v.setTextColor(Color.WHITE);
        v.setPadding(12, 16, 12, 16);
        body.addView(v);
    }
    private void button(String name, Runnable callback) {
        Button b = new Button(this);
        b.setText(name);
        b.setAllCaps(false);
        b.setOnClickListener(v -> callback.run());
        body.addView(b);
    }
    private void disabled(String feature) {
        status.setText(feature + " is not implemented. No Minecraft packets sent.");
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        show("Home");
    }
    private void show(String tab) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(20, 24, 20, 12);
        root.setBackgroundColor(Color.rgb(15, 23, 36));
        TextView title = new TextView(this);
        title.setText("MINEPILOT AI  /  " + tab.toUpperCase());
        title.setTextSize(22);
        title.setTextColor(Color.rgb(105, 230, 185));
        root.addView(title);
        LinearLayout nav = new LinearLayout(this);
        for (String page : new String[]{"Home", "Xbox", "Commands", "Tasks", "Settings", "Logs"}) {
            TextView item = new TextView(this);
            item.setText(page.substring(0, 3));
            item.setTextColor(Color.WHITE);
            item.setTextSize(12);
            item.setPadding(4, 18, 4, 18);
            item.setOnClickListener(v -> show(page));
            nav.addView(item, new LinearLayout.LayoutParams(0, -2, 1));
        }
        root.addView(nav);
        ScrollView scroll = new ScrollView(this);
        body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(body);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        status = new TextView(this);
        status.setTextColor(Color.rgb(105, 230, 185));
        status.setText("OFFLINE  •  Bedrock engine not integrated");
        root.addView(status);
        setContentView(root);
        switch (tab) {
            case "Xbox":
                label("Bot account sign-in: unavailable. Never enter Microsoft credentials here.", 16);
                EditText xuid = new EditText(this);
                xuid.setTextColor(Color.WHITE);
                xuid.setHintTextColor(Color.LTGRAY);
                xuid.setHint("Owner Xbox XUID (numeric)");
                xuid.setInputType(2);
                xuid.setText(getPreferences(MODE_PRIVATE).getString("owner_xuid", ""));
                body.addView(xuid);
                button("Save owner XUID locally", () -> {
                    String value = xuid.getText().toString().trim();
                    try {
                        if (!value.matches("[0-9]{1,20}")) throw new NumberFormatException();
                        Long.parseUnsignedLong(value);
                        getPreferences(MODE_PRIVATE).edit().putString("owner_xuid", value).apply();
                        status.setText("Saved locally. No login attempted.");
                    } catch (NumberFormatException e) { status.setText("Invalid unsigned 64-bit XUID."); }
                });
                button("Sign in to Xbox (unavailable)", () -> disabled("Xbox sign-in"));
                break;
            case "Commands":
                label("Commands are unavailable until a live Bedrock session is established.", 16);
                for (String name : new String[]{"Follow", "Come here", "Protect", "Mine", "Gather wood", "Craft", "Build", "Explore", "Return"}) {
                    button(name + " (unavailable)", () -> disabled(name));
                }
                break;
            case "Tasks":
                for (String name : new String[]{"Survival and safety", "Mining and gathering", "Crafting and inventory", "Navigation", "Blueprint building", "Redstone", "Memory and learning"}) {
                    label(name + " — planned, not implemented", 17);
                }
                break;
            case "Settings":
                label("Performance: Balanced (future option)", 17);
                label("Embedded networking runtime: NOT INSTALLED", 17);
                label("Same-phone world join: UNVERIFIED", 17);
                button("Stop diagnostic service", () -> {
                    stopService(new Intent(this, MinePilotService.class));
                    status.setText("Diagnostic service stop requested.");
                });
                break;
            case "Logs":
                label("No real game telemetry is available in this build.", 16);
                label("The connection engine has not been embedded in Android.", 16);
                break;
            default:
                label("Connection: DISCONNECTED", 21);
                label("Xbox auth: unavailable\nFriend world discovery: unavailable\nSpawn: unavailable", 16);
                button("Connect bot (unavailable)", () -> disabled("Connect"));
                button("Start diagnostic service", () -> {
                    try {
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
}
