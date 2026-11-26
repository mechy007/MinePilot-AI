package ai.minepilot.app;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewParent;

/** Touch joystick for bounded 360-degree analog manual bot movement. */
public final class ManualJoystickView extends View {
    public interface Listener {
        void onVectorChanged(float strafe, float forward);
        default void onUnavailable() {}
    }

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
    private boolean trackingTouch;
    private int activePointerId = MotionEvent.INVALID_POINTER_ID;
    private boolean controlEnabled;

    public ManualJoystickView(Context context) { super(context); init(); }
    public ManualJoystickView(Context context, AttributeSet attrs) { super(context, attrs); init(); }
    public ManualJoystickView(Context context, AttributeSet attrs, int style) { super(context, attrs, style); init(); }

    private void init() {
        setFocusable(true);
        setClickable(true);
        setContentDescription("Analog movement joystick. Drag in any direction for 360-degree movement; release to stop.");
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
        controlEnabled = enabled;
        // Keep the View touchable so an offline tap can explain what is missing.
        setEnabled(true);
        if (!enabled && trackingTouch) endTracking();
        setAlpha(enabled ? 1f : 0.58f);
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
                if (!controlEnabled) {
                    if (listener != null) listener.onUnavailable();
                    return true;
                }
                activePointerId = event.getPointerId(0);
                trackingTouch = true;
                // The joystick is inside the dashboard ScrollView. Without this,
                // a vertical drag is stolen by the parent and arrives here as CANCEL.
                disallowParentInterception(true);
                update(event.getX(0), event.getY(0));
                return true;
            case MotionEvent.ACTION_POINTER_DOWN:
                // A second finger must not steal the joystick from its owner.
                return trackingTouch;
            case MotionEvent.ACTION_MOVE: {
                if (!trackingTouch) return false;
                int pointerIndex = event.findPointerIndex(activePointerId);
                if (pointerIndex < 0) {
                    endTracking();
                    return true;
                }
                disallowParentInterception(true);
                update(event.getX(pointerIndex), event.getY(pointerIndex));
                return true;
            }
            case MotionEvent.ACTION_POINTER_UP:
                if (trackingTouch && event.getPointerId(event.getActionIndex()) == activePointerId)
                    endTracking();
                return true;
            case MotionEvent.ACTION_UP:
                if (trackingTouch) endTracking();
                performClick();
                return true;
            case MotionEvent.ACTION_CANCEL:
                if (trackingTouch) endTracking();
                return true;
            default:
                return trackingTouch;
        }
    }

    private void endTracking() {
        trackingTouch = false;
        activePointerId = MotionEvent.INVALID_POINTER_ID;
        release();
        disallowParentInterception(false);
    }

    private void disallowParentInterception(boolean disallow) {
        ViewParent parent = getParent();
        if (parent != null) parent.requestDisallowInterceptTouchEvent(disallow);
    }

    @Override protected void onDetachedFromWindow() {
        if (trackingTouch) endTracking();
        super.onDetachedFromWindow();
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
        float strafe = dx / Math.max(1f, limit);
        float forward = -dy / Math.max(1f, limit);
        float normalized = (float)Math.hypot(strafe, forward);
        if (normalized < .12f) {
            strafe = 0f;
            forward = 0f;
        } else if (normalized > 1f) {
            strafe /= normalized;
            forward /= normalized;
        }
        if (listener != null) listener.onVectorChanged(strafe, forward);
        invalidate();
    }

    private void release() {
        x = centerX;
        y = centerY;
        if (listener != null) listener.onVectorChanged(0f, 0f);
        invalidate();
    }

    @Override public boolean performClick() {
        super.performClick();
        return true;
    }
}
