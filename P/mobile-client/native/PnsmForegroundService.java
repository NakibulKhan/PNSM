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
 * that must not happen by accident.
 *
 * ON THE `@capawesome-team/capacitor-android-foreground-service` PLUGIN: both
 * blueprints name this exact package. It is a real, installable dependency
 * (already added to package.json) and would replace this hand-rolled Service
 * outright in a real integration. This scaffold keeps the hand-rolled
 * version alongside it deliberately, not out of not having gotten to it:
 * the hand-rolled Service is fully auditable (no third-party native code in
 * the location/telemetry path, which is exactly the kind of code this
 * project's own security posture treats carefully), and there is still no
 * `android/` project to wire either implementation into regardless. Adding
 * the real dependency makes the blueprint's exact-named tool available and
 * ready to evaluate the moment `npx cap add android` happens, without
 * forcing a rewrite of an already-designed scaffold on a hunch.
 *
 * Manual steps before this hand-rolled Service compiles or does anything:
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
 *
 * ===========================================================================
 * ANDROID 14/15's 6-HOUR CUMULATIVE FOREGROUND-SERVICE BUDGET (Item 12,
 * Flawless/Ultra blueprint), AND HOW THIS CODEBASE ALREADY STAYS UNDER IT.
 * ===========================================================================
 * Android 14 introduced, and Android 15 tightens, a per-24-hour-window
 * budget shared across every `dataSync`/`mediaProcessing`-type foreground
 * service a single app runs — roughly 6 cumulative hours before the OS
 * refuses to let a new one of those types start until the window resets.
 * This service already avoids competing for that budget for anything BUT
 * genuinely active tracking: periodic, low-priority heartbeat telemetry runs
 * through the Capacitor Background Runner instead (see
 * src/background/heartbeat.js and its own STATUS note on the same
 * unresolved-credential problem PnsmTelemetryUploader.java documents below),
 * which is not a foreground service at all and so never touches this budget.
 * This service's own runtime is reserved for the case the budget model is
 * actually built for: a bounded, genuinely active field-operation window, not
 * a background service kept alive all day to simulate one.
 *
 * The iOS equivalent of this same "don't let the OS silently stop tracking"
 * problem — CLLocationManager's predictive suspend-when-stationary heuristic
 * — has no service-layer analogue on Android, but see the companion scaffold
 * native/PnsmLocationDelegate.swift for the iOS-side configuration and the
 * same honest documentation convention applied there.
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
