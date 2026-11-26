package ai.minepilot.app;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.RippleDrawable;
import android.os.Build;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets.Type;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Shared app shell: branded header, scrollable screen body, status banner and bottom navigation. */
public final class DashboardShell extends LinearLayout {
    public interface NavigationListener { void onNavigate(String page); }

    private final LinearLayout content;
    private final TextView status;

    public DashboardShell(Context context, String selectedTab, NavigationListener navigation) {
        super(context);
        setOrientation(VERTICAL);
        setBackgroundColor(MinePilotTheme.BACKGROUND);
        setPadding(dp(18), dp(12), dp(18), dp(10));
        if (Build.VERSION.SDK_INT >= 30) {
            setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(Type.systemBars() | Type.displayCutout());
                view.setPadding(dp(18) + bars.left, dp(12) + bars.top,
                        dp(18) + bars.right, dp(10) + bars.bottom);
                return insets;
            });
        }

        LinearLayout heading = new LinearLayout(context);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        ImageView mark = new ImageView(context);
        mark.setImageResource(R.drawable.minepilot_icon_foreground);
        mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        heading.addView(mark, new LayoutParams(dp(46), dp(46)));

        LinearLayout brandStack = new LinearLayout(context);
        brandStack.setOrientation(VERTICAL);
        brandStack.setPadding(dp(8), 0, 0, 0);
        TextView brand = label("MinePilot", 23, MinePilotTheme.TEXT_PRIMARY, true);
        brandStack.addView(brand);
        TextView tagline = label("BEDROCK COMPANION  ·  ANDROID", 9,
                MinePilotTheme.TEXT_SECONDARY, true);
        tagline.setLetterSpacing(.12f);
        brandStack.addView(tagline);
        heading.addView(brandStack, new LayoutParams(-2, -2));
        addView(heading, new LayoutParams(-1, dp(60)));

        ScrollView scroll = new ScrollView(context);
        scroll.setFillViewport(true);
        scroll.setVerticalScrollBarEnabled(false);
        content = new LinearLayout(context);
        content.setOrientation(VERTICAL);
        content.setPadding(0, dp(6), 0, dp(16));
        scroll.addView(content);
        addView(scroll, new LayoutParams(-1, 0, 1f));

        status = label("", 13, MinePilotTheme.TEXT_PRIMARY, false);
        status.setPadding(dp(12), dp(10), dp(12), dp(10));
        status.setBackground(MinePilotTheme.surface(context, MinePilotTheme.SURFACE, 8));
        status.setVisibility(GONE);
        addView(status, new LayoutParams(-1, -2));

        LinearLayout nav = new LinearLayout(context);
        nav.setPadding(dp(5), dp(7), dp(5), dp(5));
        nav.setBackground(MinePilotTheme.surface(context, MinePilotTheme.SURFACE, 16));
        String[] pages = {"World", "Manual", "Xbox", "Skills", "Logs", "Settings"};
        for (String page : pages) {
            boolean selected = page.equals(selectedTab) ||
                    ("Settings".equals(page) && "Diagnostics".equals(selectedTab));
            String title = switch (page) {
                case "World" -> "Home";
                case "Manual" -> "Manual";
                case "Xbox" -> "Friends";
                case "Logs" -> "Activity";
                default -> page;
            };
            Button item = new Button(context);
            item.setText(title);
            item.setAllCaps(false);
            item.setTextSize(10);
            item.setMinHeight(dp(48));
            item.setPadding(dp(2), 0, dp(2), 0);
            item.setTextColor(selected ? MinePilotTheme.BACKGROUND : MinePilotTheme.TEXT_SECONDARY);
            item.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            item.setSelected(selected);
            item.setBackground(new RippleDrawable(ColorStateList.valueOf(0x2673dab6),
                    MinePilotTheme.surface(context,
                            selected ? MinePilotTheme.ACCENT : MinePilotTheme.SURFACE, 10), null));
            LayoutParams params = new LayoutParams(0, dp(48), 1f);
            params.setMargins(dp(3), 0, dp(3), 0);
            nav.addView(item, params);
            item.setOnClickListener(view -> navigation.onNavigate(page));
        }
        LayoutParams navParams = new LayoutParams(-1, -2);
        navParams.topMargin = dp(8);
        addView(nav, navParams);
    }

    public LinearLayout content() { return content; }
    public TextView status() { return status; }

    private TextView label(String value, int size, int color, boolean bold) {
        TextView text = new TextView(getContext());
        text.setText(value);
        text.setTextSize(size);
        text.setTextColor(color);
        if (bold) text.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return text;
    }

    private int dp(int value) { return MinePilotTheme.dp(getContext(), value); }
}
