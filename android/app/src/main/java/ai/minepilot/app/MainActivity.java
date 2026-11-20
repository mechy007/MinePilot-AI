package ai.minepilot.app;

import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.content.Intent;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private TextView status;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(40, 64, 40, 40);
        TextView title = new TextView(this);
        title.setText("MinePilot AI");
        title.setTextSize(28);
        root.addView(title);
        status = new TextView(this);
        status.setText("Android shell only — Xbox connection not yet available.");
        status.setPadding(0, 24, 0, 24);
        root.addView(status);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 100);
        }
        Button start = new Button(this);
        start.setText("Start service (diagnostic)");
        start.setOnClickListener(v -> {
            Intent intent = new Intent(this, MinePilotService.class);
            try {
                startForegroundService(intent);
                status.setText("Diagnostic service requested. Bot is NOT connected.");
            } catch (RuntimeException e) {
                status.setText("Service could not start: " + e.getClass().getSimpleName());
            }
        });
        root.addView(start);
        Button stop = new Button(this);
        stop.setText("Stop service");
        stop.setOnClickListener(v -> {
            stopService(new Intent(this, MinePilotService.class));
            status.setText("Service stopped. Bot is NOT connected.");
        });
        root.addView(stop);
        setContentView(root);
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == 100 && (results.length == 0 || results[0] != PackageManager.PERMISSION_GRANTED)) {
            status.setText("Notifications denied: diagnostic notification may be hidden. You can still start the service.");
        }
    }
}
