package com.pnsm.workforce;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.WorkRequest;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import androidx.annotation.NonNull;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.time.Instant;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/**
 * Companion to PnsmForegroundService.java — uploads one field-telemetry fix
 * to the backend's mobile heartbeat endpoint.
 *
 * ===========================================================================
 * STATUS: SCAFFOLD — NOT WIRED UP.
 * ===========================================================================
 * This file is NOT compiled by the current build, exactly like its sibling
 * PnsmForegroundService.java (no android/ project exists yet — npx cap add
 * android was never run). Manual steps required before this compiles:
 *
 *   1. Copy into android/app/src/main/java/com/pnsm/workforce/ alongside
 *      PnsmForegroundService.java, after `npx cap add android`.
 *   2. Add `implementation "androidx.work:work-runtime:2.9.0"` (or current)
 *      to android/app/build.gradle — the one new Gradle dependency this file
 *      needs beyond what PnsmForegroundService.java already requires.
 *   3. Set API_BASE_URL below to the real deployed backend origin. There is
 *      currently no build-time config wiring for this anywhere in the
 *      project (capacitor.config.json carries no server URL for native
 *      builds) — this constant is a placeholder, not a working default.
 *
 * ===========================================================================
 * THE UNRESOLVED PROBLEM THIS FILE DOCUMENTS RATHER THAN HIDES: NO TOKEN.
 * ===========================================================================
 * Person1_MobileClient/src/lib/http.js keeps the mobile app's access token
 * in a plain in-memory JS variable ONLY, by deliberate design — it is never
 * written to @capacitor/preferences, localStorage, or anywhere else on disk,
 * specifically so a short-lived (15-minute) token can't be read back off the
 * device later. That is the correct call for the WebView's own requests.
 *
 * It also means: under the CURRENT architecture, there is no credential this
 * native class can read to authenticate a background upload. The read below
 * against SharedPreferences("CapacitorStorage", ...) — the real, verified
 * group name @capacitor/preferences' own Android implementation uses
 * (PreferencesConfiguration.java: DEFAULTS.group = "CapacitorStorage") — will
 * always return null under the app as it exists today, because nothing ever
 * writes a token there. This is not a bug in this file to be quietly patched
 * around; it is a genuine, unresolved boundary between "background telemetry
 * needs a durable credential" and "the access token is deliberately
 * non-durable," and closing it is a deliberate team decision (e.g. minting a
 * distinct, narrowly-scoped, independently-revocable background-upload
 * credential at login, and persisting ONLY that one) — not something this
 * scaffold should invent on its own. The code below still performs the read
 * and null-checks it honestly, so this is a real starting point once that
 * decision is made, not a stub hiding behind a TODO.
 *
 * The backend's heartbeat route (Person3_BackendAPI/src/routes/mobile/
 * heartbeat.routes.ts) requires requireAuth('mobile') — there is no
 * unauthenticated fallback to fall back to, so with no token this class
 * correctly does nothing rather than send a guaranteed-401 request.
 */
final class PnsmTelemetryUploader {

    private static final String TAG = "PnsmTelemetryUploader";
    private static final String PREFS_GROUP = "CapacitorStorage";
    private static final String TOKEN_KEY = "pnsm_access_token"; // see class doc — never actually written today
    private static final String API_BASE_URL = "https://REPLACE_ME.example.invalid"; // see step 3 above
    private static final String HEARTBEAT_PATH = "/api/mobile/heartbeat";

    private PnsmTelemetryUploader() {}

    /**
     * Called from PnsmForegroundService's LocationCallback. Never throws —
     * a telemetry upload failure must not crash the foreground service.
     */
    static void enqueue(Context context, double lat, double lng, float accuracy, long timestampMs, boolean mocked) {
        // A spoofed fix must never be silently persisted as attendance
        // telemetry (PnsmForegroundService's own comment at the call site).
        // The heartbeat schema (mobileHeartbeatSchema, Person3_BackendAPI)
        // has no field to carry this flag through even if we sent it, so the
        // only safe behavior is to drop it here, before any network activity.
        if (mocked) {
            Log.w(TAG, "dropping mock-provider location fix, not uploading");
            return;
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS_GROUP, Context.MODE_PRIVATE);
        String token = prefs.getString(TOKEN_KEY, null);
        if (token == null || token.isEmpty()) {
            // Expected under the current architecture -- see the class-level
            // doc comment. Logged, not silently swallowed, so this is
            // discoverable in logcat rather than a mysterious "heartbeats
            // just don't arrive" report months later.
            Log.w(TAG, "no persisted access token available; skipping upload (see class doc comment)");
            return;
        }

        Data input = new Data.Builder()
                .putDouble("lat", lat)
                .putDouble("lng", lng)
                .putFloat("accuracy", accuracy)
                .putLong("timestampMs", timestampMs)
                .putString("token", token)
                .build();

        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(HeartbeatUploadWorker.class)
                .setInputData(input)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, WorkRequest.MIN_BACKOFF_MILLIS, TimeUnit.MILLISECONDS)
                .build();

        WorkManager.getInstance(context).enqueue(request);
    }

    /**
     * Runs off the main thread via WorkManager. Body shape matches
     * mobileHeartbeatSchema exactly (Person3_BackendAPI/src/validation/
     * mobileSchemas.ts: {lat, lng, accuracy?, timestamp}) and mirrors
     * backgroundTelemetry.js's own sendHeartbeat() body field-for-field.
     */
    public static final class HeartbeatUploadWorker extends Worker {

        public HeartbeatUploadWorker(@NonNull Context context, @NonNull WorkerParameters params) {
            super(context, params);
        }

        @NonNull
        @Override
        public Result doWork() {
            Data input = getInputData();
            String token = input.getString("token");
            if (token == null) return Result.failure();

            try {
                JSONObject body = new JSONObject();
                body.put("lat", input.getDouble("lat", 0));
                body.put("lng", input.getDouble("lng", 0));
                body.put("accuracy", input.getFloat("accuracy", 0));
                body.put("timestamp", Instant.ofEpochMilli(input.getLong("timestampMs", 0)).toString());

                HttpURLConnection conn = (HttpURLConnection) new URL(API_BASE_URL + HEARTBEAT_PATH).openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Authorization", "Bearer " + token);
                conn.setDoOutput(true);
                conn.setConnectTimeout(10_000);
                conn.setReadTimeout(10_000);

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.toString().getBytes("UTF-8"));
                }

                int status = conn.getResponseCode();
                conn.disconnect();

                if (status == 401) {
                    // A background Worker has no HttpOnly cookie jar to run
                    // the refresh-token dance against (that lives in the
                    // WebView) -- it cannot recover from this itself.
                    Log.w(TAG, "heartbeat upload got 401; token expired or invalid, not retrying");
                    return Result.failure();
                }
                if (status >= 200 && status < 300) {
                    return Result.success();
                }
                Log.w(TAG, "heartbeat upload failed, status=" + status);
                return Result.retry();
            } catch (Exception e) {
                Log.w(TAG, "heartbeat upload failed", e);
                return Result.retry();
            }
        }
    }
}
