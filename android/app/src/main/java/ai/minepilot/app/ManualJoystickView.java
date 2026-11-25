package ai.minepilot.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.View;

/** Touch joystick for bounded, cardinal manual bot movement. */
public final class ManualJoystickView extends View {
    public interface Listener { void onDirectionChanged(String direction); }

    private final Paint base = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint knob = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint cross = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint highlight = new Paint(Paint.ANTI_ALIAS_FLAG);
    private Listener listener;
    private float x;
    private float y;
    private float centerX;
    private float centerY;
    private float radius;
    private float knobRadius;
    private String direction = "";

    public ManualJoystickView(Context context) { super(context); init(); }
    public ManualJoystickView(Context context, AttributeSet attrs) { super(context, attrs); init(); }
    public ManualJoystickView(Context context, AttributeSet attrs, int style) { super(context, attrs, style); init(); }

    private void init() {
        setFocusable(true);
        setContentDescription("Manual movement joystick. Drag up, down, left or right. Release to stop.");
        base.setColor(0xff202c40);
        base.setStyle(Paint.Style.FILL);
        ring.setColor(0xff65e4ad);
        ring.setStyle(Paint.Style.STROKE);
        ring.setStrokeWidth(getResources().getDisplayMetrics().density * 2f);
        knob.setColor(0xff65e4ad);
        knob.setStyle(Paint.Style.FILL);
        cross.setColor(0xff52627a);
        cross.setStrokeWidth(getResources().getDisplayMetrics().density);
        highlight.setColor(0x55313b4e);
        highlight.setStyle(Paint.Style.STROKE);
        highlight.setStrokeWidth(getResources().getDisplayMetrics().density * 2f);
    }

    public void setListener(Listener value) { listener = value; }
    public void setControlEnabled(boolean enabled) {
        setEnabled(enabled);
        if (!enabled) release();
        invalidate();
    }

    @Override protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int desired = (int)(getResources().getDisplayMetrics().density * 176f);
        int width = resolveSize(desired, widthMeasureSpec);
        int height = resolveSize(desired, heightMeasureSpec);
        int size = Math.min(width, height);
        setMeasuredDimension(size, size);
    }

    @Override protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        centerX = w / 2f;
        centerY = h / 2f;
        radius = Math.max(1f, Math.min(w, h) * 0.42f);
        knobRadius = radius * 0.29f;
        x = centerX;
        y = centerY;
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        canvas.drawCircle(centerX, centerY, radius, base);
        canvas.drawCircle(centerX, centerY, radius, ring);
        canvas.drawLine(centerX - radius * .72f, centerY, centerX + radius * .72f, centerY, cross);
        canvas.drawLine(centerX, centerY - radius * .72f, centerX, centerY + radius * .72f, cross);
        canvas.drawCircle(x, y, knobRadius, knob);
        canvas.drawCircle(x, y, knobRadius * .68f, highlight);
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        if (!isEnabled()) return false;
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
            case MotionEvent.ACTION_MOVE:
                update(event.getX(), event.getY());
                return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                release();
                performClick();
                return true;
            default:
                return true;
        }
    }

    private void update(float touchX, float touchY) {
        float dx = touchX - centerX;
        float dy = touchY - centerY;
        float distance = (float)Math.hypot(dx, dy);
        float limit = radius * .78f;
        if (distance > limit && distance > 0f) {
            dx = dx * limit / distance;
            dy = dy * limit / distance;
        }
        x = centerX + dx;
        y = centerY + dy;
        float normalized = (float)Math.hypot(dx, dy) / Math.max(1f, limit);
        String next = "";
        if (normalized >= .22f) {
            if (Math.abs(dx) > Math.abs(dy)) next = dx < 0 ? "strafe_left" : "strafe_right";
            else next = dy < 0 ? "forward" : "backward";
        }
        if (!next.equals(direction)) {
            direction = next;
            if (listener != null) listener.onDirectionChanged(direction);
        }
        invalidate();
    }

    private void release() {
        x = centerX;
        y = centerY;
        direction = "";
        if (listener != null) listener.onDirectionChanged("");
        invalidate();
    }

    @Override public boolean performClick() {
        super.performClick();
        return true;
    }
}
