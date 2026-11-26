package ai.minepilot.app;

import android.content.Context;
import android.graphics.drawable.GradientDrawable;

/** Shared MinePilot visual tokens and native surface primitives. */
public final class MinePilotTheme {
    public static final int BACKGROUND = 0xff0d121b;
    public static final int SURFACE = 0xff171f2e;
    public static final int ACCENT = 0xff65e4ad;
    public static final int TEXT_PRIMARY = 0xffeef4ff;
    public static final int TEXT_SECONDARY = 0xffadb9cd;
    public static final int BORDER = 0xff303d52;
    public static final int WARNING = 0xffffc07a;
    public static final int DANGER = 0xffff7777;

    private MinePilotTheme() {}

    public static int dp(Context context, int value) {
        return (int) (context.getResources().getDisplayMetrics().density * value + 0.5f);
    }

    public static GradientDrawable surface(Context context, int color, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(context, radiusDp));
        drawable.setStroke(dp(context, 1), BORDER);
        return drawable;
    }
}
