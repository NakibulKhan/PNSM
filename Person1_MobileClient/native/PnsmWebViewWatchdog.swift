import WebKit

/// WKWebView GPU-process crash recovery (Item 11, Flawless/Ultra blueprint).
///
/// ===========================================================================
/// STATUS: SCAFFOLD — NOT WIRED UP.
/// ===========================================================================
/// Same convention as the Java native scaffolds in this same directory
/// (PnsmForegroundService.java, PnsmTelemetryUploader.java, PnsmRaspChecks.java):
/// NOT compiled by the current build. There is no `ios/` project either —
/// `npx cap add ios` was never run — so this file has nowhere to actually be
/// registered yet. Manual steps once that changes:
///
///   1. Copy into ios/App/App/ after `npx cap add ios`.
///   2. Make Capacitor's `CAPBridgeViewController` subclass (or the
///      `AppDelegate`, depending on which owns the WKWebView instance) adopt
///      `WKUIDelegate`/set itself as the web view's navigation delegate, and
///      call `PnsmWebViewWatchdog.install(on:)` once the web view exists.
///
/// ===========================================================================
/// THE REAL PROBLEM THIS SCAFFOLD DOCUMENTS.
/// ===========================================================================
/// Both blueprints flag the same failure mode: a WKWebView's renderer/GPU
/// process can be silently killed by iOS under memory pressure, independent
/// of the app process itself. Without handling it, the result is a
/// permanently blank white screen — the app looks "frozen," not crashed, so
/// neither the OS crash reporter nor the user's own instinct to force-quit
/// helps; the employee is simply unable to check in until they manually kill
/// and reopen the app. `webViewWebContentProcessDidTerminate(_:)` is the
/// real, documented WKNavigationDelegate callback Apple provides for exactly
/// this event.
final class PnsmWebViewWatchdog: NSObject, WKNavigationDelegate {

    /// The delegate this watchdog was installed alongside, so a genuine
    /// navigation-lifecycle event this class doesn't specifically care about
    /// still reaches the app's real navigation delegate rather than being
    /// silently swallowed. Capacitor's own bridge is typically already the
    /// WKWebView's navigationDelegate; a real integration must chain to it,
    /// not replace it outright — left as a `weak var` for the team to wire
    /// during actual integration rather than assumed here.
    weak var forwardingDelegate: WKNavigationDelegate?

    private let lastKnownRoute = PnsmLastRouteTracker.shared

    static func install(on webView: WKWebView) -> PnsmWebViewWatchdog {
        let watchdog = PnsmWebViewWatchdog()
        watchdog.forwardingDelegate = webView.navigationDelegate
        webView.navigationDelegate = watchdog
        return watchdog
    }

    // MARK: - WKNavigationDelegate

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // Logged, not silently swallowed — discoverable in a real device log
        // rather than surfacing only as "the app seems frozen sometimes."
        NSLog("[PnsmWebViewWatchdog] WKWebView content process terminated — reloading last known route")

        // Reload the WHOLE page rather than attempting any finer-grained JS
        // recovery: the WebView's entire JS execution context (including
        // in-memory state like http.js's access token — see
        // PnsmTelemetryUploader.java's own doc comment on that same
        // deliberate non-durability) is gone along with the killed process.
        // A full reload to the last known route is the only state that can
        // honestly be recovered here.
        if let url = lastKnownRoute.currentURL {
            webView.load(URLRequest(url: url))
        } else {
            webView.reload()
        }

        forwardingDelegate?.webViewWebContentProcessDidTerminate?(webView)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        lastKnownRoute.currentURL = webView.url
        forwardingDelegate?.webView?(webView, didFinish: navigation)
    }
}

/// Minimal last-known-route tracker. A real integration would likely persist
/// this via the same `@capacitor/preferences` store the JS side already
/// uses, so a route survives a full app relaunch too — left as an
/// in-memory-only scaffold here since that is a deliberate cross-layer
/// decision, the same boundary this project's other native scaffolds draw
/// rather than invent unasked.
final class PnsmLastRouteTracker {
    static let shared = PnsmLastRouteTracker()
    var currentURL: URL?
    private init() {}
}
