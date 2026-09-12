import CoreLocation

/// iOS background-location configuration and stationary-resume handling
/// (Item 12, Flawless/Ultra blueprint). The iOS-side companion to
/// PnsmForegroundService.java's own Android 14/15 foreground-service-budget
/// documentation — the two platforms hit the same underlying problem
/// ("the OS silently stops tracking a genuinely active field employee")
/// through entirely different mechanisms, so each gets its own scaffold
/// rather than a shared abstraction pretending they are the same.
///
/// ===========================================================================
/// STATUS: SCAFFOLD — NOT WIRED UP.
/// ===========================================================================
/// Same convention as every other native file in this directory: NOT
/// compiled by the current build. There is still no `ios/` project —
/// `npx cap add ios` was never run. Manual steps once that changes:
///
///   1. Copy into ios/App/App/ after `npx cap add ios`.
///   2. Add NSLocationAlwaysAndWhenInUseUsageDescription and
///      NSLocationWhenInUseUsageDescription to Info.plist (real, honest
///      copy — Apple's App Review rejects a vague background-location
///      justification the same way Google Play does for Android).
///   3. Enable the "Location updates" background mode capability in the
///      real Xcode project (Signing & Capabilities → Background Modes).
///   4. Wire `PnsmLocationDelegate` as the `CLLocationManager`'s delegate
///      from wherever the app's location tracking is actually started
///      (a genuine integration decision for the team, not invented here).
///
/// ===========================================================================
/// THE REAL PROBLEM THIS SCAFFOLD DOCUMENTS.
/// ===========================================================================
/// iOS 17/18's CLLocationManager applies a predictive heuristic that
/// automatically PAUSES location updates once it decides the device has
/// been stationary for a while — a real battery-saving feature that, for a
/// workforce-attendance app, has a real cost: an employee who is genuinely
/// stationary at a desk job, not idle, can silently stop being tracked, and
/// the app has no delegate callback that fires "updates paused" by itself —
/// the only observable symptom is that `didUpdateLocations` simply stops
/// being called. The two configuration flags below are Apple's own documented
/// way to disable the automatic pause; without both set, the OS default
/// silently overrides continuous tracking regardless of anything else this
/// class does.
final class PnsmLocationDelegate: NSObject, CLLocationManagerDelegate {

    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self

        // Both required, and both undocumented as a *pair* anywhere obvious in
        // Apple's own docs — allowsBackgroundLocationUpdates alone does not
        // disable the stationary-pause heuristic; pausesLocationUpdatesAutomatically
        // must also be explicitly set to false.
        manager.allowsBackgroundLocationUpdates = true
        manager.pausesLocationUpdatesAutomatically = false

        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
    }

    func startTracking() {
        manager.startUpdatingLocation()
    }

    func stopTracking() {
        manager.stopUpdatingLocation()
    }

    // MARK: - CLLocationManagerDelegate

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }

        // isSimulatedBySoftware is the iOS analog of Android's
        // isFromMockProvider/isMock() — see PnsmForegroundService.java's own
        // identical anti-spoofing check. A spoofed fix must never be
        // silently persisted as attendance telemetry.
        if #available(iOS 15.0, *), location.sourceInformation?.isSimulatedBySoftware == true {
            NSLog("[PnsmLocationDelegate] dropping simulated location fix, not uploading")
            return
        }

        // Real wiring (uploading via PnsmTelemetryUploader.java's Android
        // equivalent) needs the same durable-credential decision that
        // file's own doc comment already defers as a deliberate team
        // choice — not invented here either.
    }

    /// Apple's documented signal that automatic pausing kicked in despite the
    /// configuration above (e.g. a user or MDM profile overrode it). Resuming
    /// explicitly here is what keeps a genuinely active employee from
    /// silently going untracked until they happen to reopen the app.
    func locationManagerDidPauseLocationUpdates(_ manager: CLLocationManager) {
        NSLog("[PnsmLocationDelegate] location updates paused by the OS — resuming explicitly")
        manager.startUpdatingLocation()
    }
}
