package com.pnsm.workforce;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

/**
 * Android Foreground Service for persistent field telemetry (Quadrant I).
 *
 * ===========================================================================
 * STATUS: SCAFFOLD — NOT WIRED UP.
 * ===========================================================================
 * This file is NOT compiled by the current build. It is provided so the team
 * has a correct starting point, but registering it requires deliberate steps
 * that must not happen by accident:
 *
 *   1. Copy into android/app/src/main/java/com/pnsm/workforce/ after
 *      `npx cap add android`.
 *   2. Add the <service> element and FOREGROUND_SERVICE_LOCATION /
 *      ACCESS_BACKGROUND_LOCATION permissions (see AndroidManifest.snippet.xml).
 *   3. Add play-services-location to android/app/build.gradle.
 *   4. Complete the Google Play "Location Permissions" declaration. Play WILL
 *      reject a background-location app without a documented, user-visible
 *      purpose, and employee monitoring must be disclosed to the employee.
 *
 * WHY A FOREGROUND SERVICE AT ALL: on Android 8+ background services are
 * killed within minutes, and OEM ROMs (Xiaomi/Huawei/Samsung) are more
 * aggressive still. A foreground service with an ongoing notification raises
 * process priority enough to survive. The notification is not a UX wart to be
 * hidden — it is the OS-level disclosure that the employee is being tracked,
 * and suppressing it would be both technically impossible and wrong.
 *
 * NOTE ON THE HEARTBEAT: the JS-side 15s heartbeat in backgroundTelemetry.js
 * only runs while the WebView is alive. Once this service is live, the
 * authoritative interval is the LocationRequest below, and the JS heartbeat
 * should be reduced to foreground-only to avoid double-reporting.
 */
public class PnsmForegroundService extends Service {

    private static final String CHANNEL_ID = "pnsm_field_telemetry";
    private static final int NOTIFICATION_ID = 4821;
    private static final long INTERVAL_MS = 15_000L;      // per blueprint
    private static final long MIN_INTERVAL_MS = 10_000L;  // fastest accepted

    private FusedLocationProviderClient fusedClient;
    private LocationCallback locationCallback;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        fusedClient = LocationServices.getFusedLocationProviderClient(this);

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                if (result == null || result.getLastLocation() == null) return;

                android.location.Location loc = result.getLastLocation();

                // Anti-spoofing at the source. isMock() is API 31+;
                // isFromMockProvider() is the pre-31 equivalent. A spoofed fix
                // must never be silently persisted as attendance telemetry.
                boolean mocked;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    mocked = loc.isMock();
                } else {
                    mocked = loc.isFromMockProvider();
                }

                PnsmTelemetryUploader.enqueue(
                    getApplicationContext(),
                    loc.getLatitude(),
                    loc.getLongitude(),
                    loc.getAccuracy(),
                    System.currentTimeMillis(),
                    mocked
                );
            }
        };
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(NOTIFICATION_ID, buildNotification());

        LocationRequest request = new LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_MS)
                .setMinUpdateIntervalMillis(MIN_INTERVAL_MS)
                .setWaitForAccurateLocation(false)
                .build();

        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
        } catch (SecurityException se) {
            // Permission revoked while running — stop rather than crash-loop.
            stopSelf();
            return START_NOT_STICKY;
        }

        // START_STICKY: ask the OS to restart us if we are killed for memory.
        return START_STICKY;
    }

    private Notification buildNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("PNSM attendance tracking active")
                .setContentText("Your location is being recorded during your shift.")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Field telemetry",
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shown while PNSM is recording your shift location.");
            NotificationManager mgr = getSystemService(NotificationManager.class);
            if (mgr != null) mgr.createNotificationChannel(channel);
        }
    }

    @Override
    public void onDestroy() {
        if (fusedClient != null && locationCallback != null) {
            fusedClient.removeLocationUpdates(locationCallback);
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null; // started service, not bound
    }
}
