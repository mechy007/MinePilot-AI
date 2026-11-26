package ai.minepilot.app;

import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Dedicated renderer for the bot capability/skills screen. */
public final class SkillsScreen {
    private SkillsScreen() {}

    public static void render(Context context, LinearLayout body) {
        hero(context, body, "BOT SKILLS", "Capabilities",
                "See what the bot can observe, plan and safely execute.");
        skill(context, body, "Vitals awareness", "Available", MinePilotTheme.ACCENT,
                "Reads the bot's health and hunger while connected and flags low vitals.");
        section(context, body, "Experimental and planned");
        skill(context, body, "Follow a player", "Planning only", MinePilotTheme.WARNING,
                "Tracks a selected, observed player and prepares a bounded follow plan. Live autonomous following is not yet verified.");
        skill(context, body, "Resource observations", "Experimental", MinePilotTheme.WARNING,
                "Reads item registry, nearby drops and block updates; automatic gathering is not yet available.");
        skill(context, body, "Survival priorities", "Experimental", MinePilotTheme.WARNING,
                "Prioritizes health and hunger observations and can pause plans; it does not automatically eat or fight.");
        skill(context, body, "Craft and shelter plans", "Preview only", MinePilotTheme.WARNING,
                "Estimates materials and previews construction steps; crafting and block placement are not enabled.");
    }

    private static void hero(Context context, LinearLayout body, String eyebrow, String title, String detail) {
        LinearLayout panel = new LinearLayout(context);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(context, 16), dp(context, 16), dp(context, 16), dp(context, 16));
        GradientDrawable backdrop = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[]{0xff193a36, 0xff172236});
        backdrop.setStroke(dp(context, 1), 0xff37645e);
        backdrop.setCornerRadius(dp(context, 16));
        panel.setBackground(backdrop);
        TextView tag = text(context, eyebrow, 10, MinePilotTheme.ACCENT, true);
        panel.addView(tag);
        TextView heading = text(context, title, 27, MinePilotTheme.TEXT_PRIMARY, true);
        heading.setPadding(0, dp(context, 5), 0, dp(context, 4));
        panel.addView(heading);
        panel.addView(text(context, detail, 13, MinePilotTheme.TEXT_SECONDARY, false));
        LayoutParams params = new LayoutParams(-1, -2);
        params.bottomMargin = dp(context, 14);
        body.addView(panel, params);
    }

    private static void section(Context context, LinearLayout body, String title) {
        TextView heading = text(context, title, 16, MinePilotTheme.TEXT_PRIMARY, true);
        heading.setPadding(0, dp(context, 14), 0, dp(context, 8));
        body.addView(heading);
    }

    private static void skill(Context context, LinearLayout body, String name,
            String availability, int color, String description) {
        LinearLayout panel = new LinearLayout(context);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(context, 15), dp(context, 13), dp(context, 15), dp(context, 13));
        panel.setBackground(MinePilotTheme.surface(context, MinePilotTheme.SURFACE, 14));
        panel.addView(text(context, availability, 11, color, true));
        TextView title = text(context, name, 18, MinePilotTheme.TEXT_PRIMARY, true);
        title.setPadding(0, dp(context, 4), 0, dp(context, 4));
        panel.addView(title);
        panel.addView(text(context, description, 13, MinePilotTheme.TEXT_SECONDARY, false));
        LayoutParams params = new LayoutParams(-1, -2);
        params.bottomMargin = dp(context, 9);
        body.addView(panel, params);
    }

    private static TextView text(Context context, String value, int size, int color, boolean bold) {
        TextView text = new TextView(context);
        text.setText(value);
        text.setTextSize(size);
        text.setTextColor(color);
        if (bold) text.setTypeface(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD);
        return text;
    }

    private static int dp(Context context, int value) { return MinePilotTheme.dp(context, value); }
}
