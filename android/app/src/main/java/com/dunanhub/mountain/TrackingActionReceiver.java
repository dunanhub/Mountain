package com.dunanhub.mountain;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;

import androidx.core.app.ActivityCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationServices;

import org.json.JSONArray;
import org.json.JSONObject;

public class TrackingActionReceiver extends BroadcastReceiver {
    private static final String PREFS = "MountainTrackerPrefs";
    private static final String MARKERS_KEY = "native_markers";
    private static final String STOP_KEY = "stop_requested";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();

        if ("STOP".equals(action)) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, 0);
            prefs.edit().putBoolean(STOP_KEY, true).apply();

            Intent serviceIntent = new Intent(context, TrackingNotificationService.class);
            context.stopService(serviceIntent);
            return;
        }

        if ("WATER".equals(action)) {
            saveMarker(context, "water", "Вода");
        }

        if ("CAMP".equals(action)) {
            saveMarker(context, "camp", "Лагерь");
        }

        if ("DANGER".equals(action)) {
            saveMarker(context, "danger", "Опасность");
        }
    }

    private void saveMarker(Context context, String type, String title) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, 0);

            if (!prefs.contains("last_lat") || !prefs.contains("last_lng")) {
                return;
            }

            float lat = prefs.getFloat("last_lat", 0);
            float lng = prefs.getFloat("last_lng", 0);
            float accuracy = prefs.getFloat("last_accuracy", 0);
            float altitude = prefs.getFloat("last_altitude", 0);

            String raw = prefs.getString(MARKERS_KEY, "[]");
            JSONArray array = new JSONArray(raw);

            JSONObject marker = new JSONObject();
            marker.put("type", type);
            marker.put("title", title);
            marker.put("lat", lat);
            marker.put("lng", lng);
            marker.put("accuracy", accuracy);
            marker.put("altitude", altitude);
            marker.put("createdAt", System.currentTimeMillis());

            array.put(marker);

            prefs.edit().putString(MARKERS_KEY, array.toString()).apply();
        } catch (Exception ignored) {
        }
    }
}