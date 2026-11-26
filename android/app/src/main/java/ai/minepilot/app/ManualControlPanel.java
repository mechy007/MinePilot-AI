package ai.minepilot.app;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.RippleDrawable;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.ArrayList;

/** Phone-first movement surface. It renders controls and forwards intent to the session owner. */
public final class ManualControlPanel extends LinearLayout {
    public interface Listener {
        void onVectorChanged(float strafe, float forward);
        void onActionChanged(String mode, boolean pressed);
        void onLookChanged(String mode, boolean pressed);
        void onStop();
        void onUnavailable();
    }

    private final Listener listener;
    private final ManualJoystickView joystick;
    private final ArrayList<View> gatedControls = new ArrayList<>();
    private boolean controlEnabled;

    public ManualControlPanel(Context context, Listener listener) {
        super(context);
        this.listener = listener;
        setOrientation(VERTICAL);
        setPadding(dp(15), dp(14), dp(15), dp(14));
        setBackground(MinePilotTheme.surface(context, MinePilotTheme.SURFACE, 16));

        addView(label("MANUAL MOVEMENT", 11, MinePilotTheme.ACCENT, true));
        TextView hint = label(
                "Drag to move in any direction. Release to brake. Hold camera and action controls while the bot is in the world.",
                12, MinePilotTheme.TEXT_SECONDARY, false);
        hint.setPadding(0, dp(6), 0, dp(12));
        addView(hint);

        joystick = new ManualJoystickView(context);
        joystick.setListener(new ManualJoystickView.Listener() {
            @Override public void onVectorChanged(float strafe, float forward) {
                if (ManualControlPanel.this.listener != null)
                    ManualControlPanel.this.listener.onVectorChanged(strafe, forward);
            }
            @Override public void onUnavailable() {
                if (ManualControlPanel.this.listener != null)
                    ManualControlPanel.this.listener.onUnavailable();
            }
        });
        LayoutParams stickParams = new LayoutParams(dp(168), dp(168));
        stickParams.gravity = Gravity.CENTER_HORIZONTAL;
        stickParams.bottomMargin = dp(12);
        addView(joystick, stickParams);

        LinearLayout look = new LinearLayout(context);
        look.setOrientation(VERTICAL);
        look.setGravity(Gravity.CENTER_HORIZONTAL);
        look.addView(label("CAMERA", 10, MinePilotTheme.ACCENT, true));
        LinearLayout horizontalLook = controlRow();
        addControl(horizontalLook, "LOOK LEFT", "turn_left", false);
        addControl(horizontalLook, "LOOK RIGHT", "turn_right", false);
        look.addView(horizontalLook);
        LinearLayout verticalLook = controlRow();
        addControl(verticalLook, "LOOK UP", "look_up", false);
        addControl(verticalLook, "LOOK DOWN", "look_down", false);
        look.addView(verticalLook);
        LinearLayout actions = controlRow();
        addControl(actions, "JUMP", "jump", true);
        addControl(actions, "SPRINT", "sprint", true);
        addControl(actions, "SNEAK", "sneak", true);
        look.addView(actions);
        Button stop = button("STOP", true);
        stop.setContentDescription("Stop all manual movement");
        stop.setOnClickListener(view -> {
            if (this.listener != null) this.listener.onStop();
        });
        LayoutParams stopParams = new LayoutParams(-1, dp(50));
        stopParams.topMargin = dp(4);
        look.addView(stop, stopParams);
        addView(look, new LayoutParams(-1, -2));

        TextView footer = label(
                "Movement is enabled only when the server authority, physics runtime and observed terrain are ready.",
                11, MinePilotTheme.TEXT_SECONDARY, false);
        footer.setPadding(0, dp(9), 0, 0);
        addView(footer);
        setControlEnabled(false);
    }

    public void setControlEnabled(boolean enabled) {
        boolean changed = controlEnabled != enabled;
        controlEnabled = enabled;
        joystick.setControlEnabled(enabled);
        for (View view : gatedControls) {
            view.setEnabled(true);
            view.setAlpha(enabled ? 1f : 0.58f);
        }
        if (changed && !enabled && listener != null) listener.onStop();
    }

    private void addControl(LinearLayout row, String title, String mode, boolean action) {
        Button control = button(title, false);
        control.setTextSize(title.length() > 3 ? 10 : 18);
        control.setContentDescription(title + ". Press and hold.");
        final boolean[] acceptedPress = { false };
        control.setEnabled(true);
        control.setOnTouchListener((view, event) -> {
            int actionType = event.getActionMasked();
            if (actionType == MotionEvent.ACTION_DOWN) {
                if (!controlEnabled) {
                    acceptedPress[0] = false;
                    if (listener != null) listener.onUnavailable();
                    return true;
                }
                if (view.getParent() != null)
                    view.getParent().requestDisallowInterceptTouchEvent(true);
                acceptedPress[0] = true;
                view.setPressed(true);
                if (listener != null) {
                    if (action) listener.onActionChanged(mode, true);
                    else listener.onLookChanged(mode, true);
                }
                return true;
            }
            if (actionType == MotionEvent.ACTION_UP || actionType == MotionEvent.ACTION_CANCEL) {
                if (view.getParent() != null)
                    view.getParent().requestDisallowInterceptTouchEvent(false);
                view.setPressed(false);
                if (acceptedPress[0] && listener != null) {
                    if (action) listener.onActionChanged(mode, false);
                    else listener.onLookChanged(mode, false);
                }
                acceptedPress[0] = false;
                return true;
            }
            return true;
        });
        gatedControls.add(control);
        LayoutParams params = new LayoutParams(0, dp(50), 1f);
        params.setMargins(dp(3), dp(3), dp(3), dp(3));
        row.addView(control, params);
    }

    private LinearLayout controlRow() {
        LinearLayout row = new LinearLayout(getContext());
        row.setOrientation(HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        return row;
    }

    private Button button(String title, boolean primary) {
        Button result = new Button(getContext());
        result.setText(title);
        result.setAllCaps(false);
        result.setTextSize(14);
        result.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        result.setTextColor(primary ? MinePilotTheme.BACKGROUND : MinePilotTheme.TEXT_PRIMARY);
        result.setGravity(Gravity.CENTER);
        result.setMinimumHeight(dp(48));
        result.setPadding(dp(8), dp(7), dp(8), dp(7));
        result.setBackground(new RippleDrawable(
                ColorStateList.valueOf(0x3373dab6),
                MinePilotTheme.surface(getContext(),
                        primary ? MinePilotTheme.ACCENT : 0xff202b3d, 12), null));
        return result;
    }

    private TextView label(String value, int size, int color, boolean bold) {
        TextView result = new TextView(getContext());
        result.setText(value);
        result.setTextSize(size);
        result.setTextColor(color);
        if (bold) result.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return result;
    }

    private int dp(int value) { return MinePilotTheme.dp(getContext(), value); }
}
