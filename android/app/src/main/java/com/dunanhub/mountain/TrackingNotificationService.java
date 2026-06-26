package com.dunanhub.mountain;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

public class TrackingNotificationService extends Service {
    public static final String CHANNEL_ID = "mountain_tracker_channel";

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        startForeground(1001, buildNotification());
    }

    private Notification buildNotification() {
        PendingIntent stopIntent = actionIntent("STOP");
        PendingIntent waterIntent = actionIntent("WATER");
        PendingIntent campIntent = actionIntent("CAMP");
        PendingIntent dangerIntent = actionIntent("DANGER");

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentTitle("Mountain Tracker работает")
                .setContentText("GPS-маршрут записывается")
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .addAction(0, "Стоп", stopIntent)
                .addAction(0, "Вода", waterIntent)
                .addAction(0, "Лагерь", campIntent)
                .addAction(0, "Опасность", dangerIntent)
                .build();
    }

    private PendingIntent actionIntent(String action) {
        Intent intent = new Intent(this, TrackingActionReceiver.class);
        intent.setAction(action);

        return PendingIntent.getBroadcast(
                this,
                action.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void createChannel() {
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Mountain Tracker",
                NotificationManager.IMPORTANCE_HIGH
        );

        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(channel);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}