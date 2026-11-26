package ai.minepilot.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.Bundle;
import android.view.View;

/**
 * Lightweight 2D live health monitor. Data is supplied by the existing
 * one-second world-status poll; this view never invents missing telemetry.
 */
public final class HealthMonitorView extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final float density;
    private Bundle snapshot = Bundle.EMPTY;
    private boolean runtimeAvailable;

    public HealthMonitorView(Context context) {
        super(context);
        density = context.getResources().getDisplayMetrics().density;
        setMinimumHeight(dp(252));
        setContentDescription("Live MinePilot system and player health monitor");
    }

    public void update(Bundle current, boolean available) {
        snapshot = current == null ? Bundle.EMPTY : new Bundle(current);
        runtimeAvailable = available;
        String phase = snapshot.getString("phase", "");
        String health = snapshot.getString("health", "—");
        String hunger = snapshot.getString("hunger", "—");
        String capability = snapshot.getString("movement_capability", "unavailable");
        setContentDescription("MinePilot live health monitor. Connection: "
                + (available ? phase : "runtime unavailable")
                + ". Player health: " + health + ". Hunger: " + hunger
                + ". Movement: " + capability.replace('_', ' '));
        invalidate();
    }

    @Override protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int width = MeasureSpec.getSize(widthMeasureSpec);
        int desired = dp(252);
        int height = resolveSize(desired, heightMeasureSpec);
        setMeasuredDimension(width, height);
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float w = getWidth();
        float pad = dp(14);
        float inner = Math.max(0, w - pad * 2);
        paint.setColor(0xff172236);
        canvas.drawRoundRect(new RectF(pad, dp(5), w - pad, getHeight() - dp(5)), dp(14), dp(14), paint);

        drawText(canvas, "LIVE SYSTEM HEALTH", pad * 2, dp(28), 10, 0xff73dab6, true);
        drawText(canvas, runtimeAvailable ? "MONITORING" : "RUNTIME OFFLINE",
                w - pad * 2, dp(28), 9, runtimeAvailable ? 0xff73dab6 : 0xffffb86b, true, true);

        float y = dp(55);
        float gap = dp(8);
        float col = (inner - gap) / 2f;
        String phase = snapshot.getString("phase", "");
        boolean connected = runtimeAvailable && ("spawned".equals(phase) || "connecting".equals(phase));
        boolean alive = "spawned".equals(phase)
                && !"dead".equalsIgnoreCase(snapshot.getString("life_state", ""))
                && !"dead".equalsIgnoreCase(snapshot.getString("assessment", ""));
        boolean movementReady = alive && snapshot.getBoolean("movement_ready", false);
        boolean agentActive = alive && snapshot.getBoolean("agent_active", false);

        tile(canvas, pad, y, col, "CONNECTION",
                !runtimeAvailable ? "Unavailable" : connected ? phaseLabel(phase) : "Offline",
                !runtimeAvailable ? 0xffffb86b : connected ? 0xff73dab6 : 0xff8995a8);
        tile(canvas, pad + col + gap, y, col, "PLAYER",
                !runtimeAvailable ? "Unknown" : alive ? "Alive" : "Not spawned",
                alive ? 0xff73dab6 : 0xffffb86b);
        y += dp(58);
        tile(canvas, pad, y, col, "MOVEMENT",
                !runtimeAvailable ? "Unknown" : movementReady ? "Ready" : "Waiting",
                movementReady ? 0xff73dab6 : 0xffffb86b);
        tile(canvas, pad + col + gap, y, col, "AI AGENT",
                !runtimeAvailable ? "Unknown" : agentActive ? "Active" : "Idle",
                agentActive ? 0xff73dab6 : 0xff8995a8);

        y += dp(65);
        drawText(canvas, "PLAYER VITALS", pad * 2, y, 10, 0xffaab6c8, true);
        String health = snapshot.getString("health", "—");
        String hunger = snapshot.getString("hunger", "—");
        drawText(canvas, "Health  " + health, pad * 2, y + dp(20), 11, 0xfff2f5fa, true);
        drawText(canvas, "Hunger  " + hunger, pad * 2 + col + gap, y + dp(20), 11, 0xfff2f5fa, true);
        drawBar(canvas, pad * 2, y + dp(28), col - dp(10), parseRatio(health));
        drawBar(canvas, pad * 2 + col + gap, y + dp(28), col - dp(10), parseRatio(hunger));

        String reason = snapshot.getString("movement_last_reason", "");
        if (reason.isEmpty()) reason = snapshot.getString("agent_reason", "");
        String detail = !runtimeAvailable ? "Join a world to begin telemetry."
                : !reason.isEmpty() ? reason.replace('_', ' ')
                : "Session " + snapshot.getString("session_id", "—")
                    + "  ·  " + snapshot.getLong("chunks", 0) + " chunks";
        drawText(canvas, detail, pad * 2, getHeight() - dp(16), 9, 0xffaab6c8, false);
    }

    private void tile(Canvas canvas, float x, float y, float width,
            String title, String value, int statusColor) {
        paint.setColor(0xff202d42);
        canvas.drawRoundRect(new RectF(x, y, x + width, y + dp(49)), dp(8), dp(8), paint);
        paint.setColor(statusColor);
        canvas.drawCircle(x + dp(10), y + dp(16), dp(3), paint);
        drawText(canvas, title, x + dp(19), y + dp(19), 8, 0xffaab6c8, true);
        drawText(canvas, value, x + dp(10), y + dp(38), 11, 0xfff2f5fa, true);
    }

    private void drawBar(Canvas canvas, float x, float y, float width, float ratio) {
        paint.setColor(0xff344258);
        canvas.drawRoundRect(new RectF(x, y, x + width, y + dp(5)), dp(3), dp(3), paint);
        if (ratio >= 0) {
            paint.setColor(ratio < .3f ? 0xffffb86b : 0xff73dab6);
            canvas.drawRoundRect(new RectF(x, y, x + width * ratio, y + dp(5)), dp(3), dp(3), paint);
        }
    }

    private float parseRatio(String value) {
        if (value == null || value.isEmpty() || "—".equals(value)) return -1f;
        try {
            String[] parts = value.split("/");
            float current = Float.parseFloat(parts[0].trim());
            float maximum = parts.length > 1 ? Float.parseFloat(parts[1].trim()) : 20f;
            if (maximum <= 0) return -1f;
            return Math.max(0f, Math.min(1f, current / maximum));
        } catch (RuntimeException ignored) {
            return -1f;
        }
    }

    private String phaseLabel(String phase) {
        return switch (phase) {
            case "spawned" -> "Connected";
            case "connecting" -> "Connecting";
            default -> phase;
        };
    }

    private void drawText(Canvas canvas, String value, float x, float y,
            float size, int color, boolean bold) {
        drawText(canvas, value, x, y, size, color, bold, false);
    }

    private void drawText(Canvas canvas, String value, float x, float y,
            float size, int color, boolean bold, boolean rightAligned) {
        paint.setColor(color);
        paint.setTextSize(dp(size));
        paint.setTypeface(bold ? android.graphics.Typeface.create(
                "sans-serif", android.graphics.Typeface.BOLD) : android.graphics.Typeface.DEFAULT);
        paint.setTextAlign(rightAligned ? Paint.Align.RIGHT : Paint.Align.LEFT);
        canvas.drawText(value == null ? "—" : value, x, y, paint);
        paint.setTextAlign(Paint.Align.LEFT);
    }

    private int dp(float value) { return Math.round(value * density); }
}
