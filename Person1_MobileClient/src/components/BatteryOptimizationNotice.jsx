import React, { useState } from "react";
import { getBatteryOptimizationGuidance } from "../lib/backgroundTelemetry";

/**
 * Surfaces `getBatteryOptimizationGuidance()` (backgroundTelemetry.js) as a
 * real UI element. That function was already written and already correct —
 * it deliberately stops short of triggering the native
 * ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS intent, since Play Store policy
 * requires a documented justification before an app can prompt for that, and
 * wiring it without one is a real store-rejection risk (see the function's
 * own docstring). This component only ever shows a passive, informational
 * link — nothing here requests any permission or triggers any system dialog,
 * so it carries none of that risk.
 *
 * Renders nothing at all on web/iOS (`guidance` is `null` there) and nothing
 * once dismissed. `dismissible` is a plain in-memory useState flag, not
 * persisted — this app makes no other use of @capacitor/preferences, and
 * adding a persistence layer for a cosmetic dismiss flag isn't worth being
 * the first caller of it. Resetting on next launch is an acceptable,
 * deliberately-scoped trade-off, not an oversight.
 */
export default function BatteryOptimizationNotice({ dismissible = true }) {
  const guidance = getBatteryOptimizationGuidance();
  const [dismissed, setDismissed] = useState(false);

  if (!guidance?.needed || (dismissible && dismissed)) return null;

  return (
    <div className="mt-4 rounded-xl border border-warning-amber bg-surface-container-lowest p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wide text-warning-amber">
            Background tracking may be restricted
          </p>
          <p className="mt-1 text-xs text-on-surface-variant">{guidance.note}</p>
          <a
            href={guidance.guidanceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs font-semibold text-warning-amber underline"
          >
            {guidance.guidanceUrl}
          </a>
        </div>
        {dismissible && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="shrink-0 text-xs font-semibold text-on-surface-variant"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
