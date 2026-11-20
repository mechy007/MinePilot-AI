package ai.minepilot.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

public final class MinePilotService extends Service {
    private static final String CHANNEL_ID = "minepilot_diagnostic";
    @Override public void onCreate() {
        super.onCreate();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "MinePilot diagnostics", NotificationManager.IMPORTANCE_LOW));
        Notification notification = new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("MinePilot AI")
                .setContentText("Diagnostic service only — not connected to Minecraft")
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .build();
        startForeground(1, notification);
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        return START_NOT_STICKY;
    }
    @Override public void onTimeout(int startId, int fgsType) { stopSelf(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
