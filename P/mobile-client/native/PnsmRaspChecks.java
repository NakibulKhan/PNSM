package com.pnsm.workforce;

import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.net.InetSocketAddress;
import java.net.Socket;

/**
 * Runtime Application Self-Protection: root and dynamic-instrumentation
 * detection (Item 6, Flawless/Ultra blueprint — M7: Insufficient Binary
 * Protections).
 *
 * ===========================================================================
 * STATUS: SCAFFOLD — NOT WIRED UP.
 * ===========================================================================
 * Same convention as PnsmForegroundService.java / PnsmTelemetryUploader.java
 * in this same package: NOT compiled by the current build (there is still no
 * android/ project — `npx cap add android` was never run). Manual steps
 * before this compiles or does anything:
 *
 *   1. Copy into android/app/src/main/java/com/pnsm/workforce/ after
 *      `npx cap add android`.
 *   2. Call {@link #isCompromised(Context)} from the app's entry point
 *      (e.g. MainActivity.onCreate(), before the WebView loads any
 *      authenticated route) and wire the intended response — see below.
 *
 * ===========================================================================
 * THE INTENDED RESPONSE THIS FILE DOCUMENTS RATHER THAN IMPLEMENTS.
 * ===========================================================================
 * On a positive detection, the blueprint's intended behavior is: purge the
 * in-memory access token and force a logout, the same fail-closed posture
 * SecurityGuards already applies server-side to a rooted device (see
 * Person4_AIBiometricService/app/security/guards.py's own comment: rooting
 * is logged there, not blocked, because "a real attacker would simply
 * suppress" the signal — the point of THIS check is the reverse: raising the
 * cost of tampering with the client binary specifically, not proving a
 * device is trustworthy). This file cannot perform that purge itself:
 * Person1_MobileClient/src/lib/http.js keeps the access token in a plain JS
 * variable inside the WebView's JS engine, which native Java code has no
 * direct handle to. The real wiring is a Capacitor plugin bridge call (a
 * custom native<->JS bridge method invoked from here, which the WebView side
 * then uses to clear its in-memory token and navigate to the login screen)
 * — a genuine cross-layer integration decision for the team to make
 * deliberately, not something this scaffold should invent unasked, the same
 * boundary PnsmTelemetryUploader.java's own doc comment already draws for
 * the background-upload credential problem.
 *
 * ===========================================================================
 * WHAT THIS ACTUALLY CHECKS, AND ITS HONEST LIMITS.
 * ===========================================================================
 * These are standard, well-known heuristics — not a certified anti-tampering
 * product. A sufficiently motivated attacker (a custom ROM, a root cloaking
 * Xposed/Magisk module, a patched Frida gadget with a renamed process) can
 * evade any single one of these checks. Layering several raises the cost of
 * casual tampering; it does not make the client trustworthy the way a
 * hardware-backed attestation (Play Integrity API) would. That limitation is
 * stated here rather than papered over, the same discipline
 * app/security/guards.py's own module docstring already applies to its
 * client-reported device signals.
 */
final class PnsmRaspChecks {

    private static final String TAG = "PnsmRaspChecks";

    /** Common su binary locations on a rooted device. */
    private static final String[] SU_PATHS = {
        "/sbin/su", "/system/bin/su", "/system/xbin/su",
        "/data/local/xbin/su", "/data/local/bin/su", "/system/sd/xbin/su",
        "/system/bin/failsafe/su", "/data/local/su", "/su/bin/su",
    };

    /** Package names of common root-management apps. */
    private static final String[] ROOT_MANAGEMENT_PACKAGES = {
        "com.topjohnwu.magisk", "eu.chainfire.supersu", "com.noshufou.android.su",
        "com.koushikdutta.superuser", "com.thirdparty.superuser", "com.yellowes.su",
    };

    /** Frida's default listening port on Android; a non-default port defeats this specific check. */
    private static final int FRIDA_DEFAULT_PORT = 27042;

    private PnsmRaspChecks() {}

    /** True if any check below finds a positive signal. Never throws — a failed check is not itself a compromise signal. */
    static boolean isCompromised(Context context) {
        return isRooted(context) || hasFridaServer() || hasSuspiciousMaps();
    }

    // ------------------------------------------------------------------ root
    private static boolean isRooted(Context context) {
        return hasSuBinary() || hasTestKeysBuildTag() || hasRootManagementPackage(context);
    }

    private static boolean hasSuBinary() {
        for (String path : SU_PATHS) {
            if (new File(path).exists()) {
                Log.w(TAG, "RASP: su binary found at " + path);
                return true;
            }
        }
        return false;
    }

    /** A stock, unmodified retail build reports "release-keys"; a custom/dev build reports "test-keys". */
    private static boolean hasTestKeysBuildTag() {
        String tags = Build.TAGS;
        boolean flagged = tags != null && tags.contains("test-keys");
        if (flagged) Log.w(TAG, "RASP: Build.TAGS contains test-keys (" + tags + ")");
        return flagged;
    }

    private static boolean hasRootManagementPackage(Context context) {
        PackageManager pm = context.getPackageManager();
        for (String pkg : ROOT_MANAGEMENT_PACKAGES) {
            try {
                pm.getPackageInfo(pkg, 0);
                Log.w(TAG, "RASP: root-management package installed: " + pkg);
                return true;
            } catch (PackageManager.NameNotFoundException notInstalled) {
                // expected for every package that is NOT present; keep checking the rest
            }
        }
        return false;
    }

    // --------------------------------------------------------------- frida
    /** A Frida server exposes a TCP control port on the device; a bound listener there is a strong signal. */
    private static boolean hasFridaServer() {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", FRIDA_DEFAULT_PORT), 200);
            Log.w(TAG, "RASP: a listener answered on the default Frida port " + FRIDA_DEFAULT_PORT);
            return true;
        } catch (Exception notListening) {
            // Expected on a clean device: nothing is listening, or the connection timed out.
            return false;
        }
    }

    /** A loaded Frida gadget/agent maps a recognisable shared library into this process's own memory. */
    private static boolean hasSuspiciousMaps() {
        try (BufferedReader reader = new BufferedReader(new FileReader("/proc/self/maps"))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.contains("frida") || line.contains("gum-js-loop") || line.contains("linjector")) {
                    Log.w(TAG, "RASP: /proc/self/maps contains a known instrumentation-framework mapping");
                    return true;
                }
            }
        } catch (Exception unreadable) {
            // /proc/self/maps is normally always readable by the owning process; a failure here
            // is itself unusual, but treated as "no signal" rather than a false positive.
        }
        return false;
    }
}
