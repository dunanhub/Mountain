package com.dunanhub.mountain;

import android.content.Intent;
import android.content.SharedPreferences;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

@CapacitorPlugin(name = "TrackingWidget")
public class TrackingWidgetPlugin extends Plugin {
    private static final String PREFS = "MountainTrackerPrefs";
    private static final String MARKERS_KEY = "native_markers";
    private static final String STOP_KEY = "stop_requested";

    @PluginMethod
    public void start(PluginCall call) {
        Intent intent = new Intent(getContext(), TrackingNotificationService.class);
        getContext().startForegroundService(intent);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), TrackingNotificationService.class);
        getContext().stopService(intent);
        call.resolve();
    }

    @PluginMethod
    public void readMarkers(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
        String raw = prefs.getString(MARKERS_KEY, "[]");

        JSObject result = new JSObject();

        try {
            result.put("markers", new JSArray(new JSONArray(raw)));
        } catch (Exception e) {
            result.put("markers", new JSArray());
        }

        call.resolve(result);
    }

    @PluginMethod
    public void clearMarkers(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
        prefs.edit().putString(MARKERS_KEY, "[]").apply();
        call.resolve();
    }

    @PluginMethod
    public void readStopRequested(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
        boolean requested = prefs.getBoolean(STOP_KEY, false);

        JSObject result = new JSObject();
        result.put("stopRequested", requested);

        call.resolve(result);
    }

    @PluginMethod
    public void clearStopRequested(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
        prefs.edit().putBoolean(STOP_KEY, false).apply();
        call.resolve();
    }

    @PluginMethod
    public void saveLastLocation(PluginCall call) {
        double lat = call.getDouble("lat");
        double lng = call.getDouble("lng");
        double accuracy = call.getDouble("accuracy", 0.0);
        double altitude = call.getDouble("altitude", 0.0);

        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);

        prefs.edit()
            .putFloat("last_lat", (float) lat)
            .putFloat("last_lng", (float) lng)
            .putFloat("last_accuracy", (float) accuracy)
            .putFloat("last_altitude", (float) altitude)
            .putLong("last_location_time", System.currentTimeMillis())
            .apply();

        call.resolve();
    }
}