import React from "react";
import { useApp } from "../state/AppContext";
import { OFFICES } from "../lib/geofence";
import { clearAccessToken } from "../lib/http";
import { stopTelemetry, getTelemetryCapability, getBatteryOptimizationGuidance } from "../lib/backgroundTelemetry";

export default function ProfileScreen() {
  const { state, dispatch } = useApp();
  const telemetry = getTelemetryCapability();
  const battery = getBatteryOptimizationGuidance();

  return (
    <div className="px-5 pb-28 pt-8">
      <h1 className="mb-6 font-display text-2xl font-bold text-text-navy">Profile</h1>

      <div className="rounded-xl border border-surface-border bg-surface-container-lowest p-5">
        <p className="font-semibold text-text-navy">{state.employee.fullName}</p>
        <p className="font-mono text-xs text-on-surface-variant">{state.employee.id}</p>
      </div>

      <div className="mt-4 rounded-xl border border-surface-border bg-surface-container-lowest p-5">
        <label className="mb-2 block font-mono text-[11px] uppercase text-on-surface-variant">
          Assigned office
        </label>
        <select
          value={state.office.key}
          onChange={(e) => dispatch({ type: "SET_OFFICE", office: OFFICES[e.target.value] })}
          className="w-full rounded-lg border border-surface-border bg-surface-bright px-3 py-3"
        >
          {Object.values(OFFICES).map((o) => (
            <option key={o.key} value={o.key}>
              {o.name}
            </option>
          ))}
        </select>
        <p className="mt-2 font-mono text-xs text-on-surface-variant">
          Radius {state.office.radiusMeters}m
        </p>
      </div>

      {/* Employees are entitled to see whether they are being tracked. */}
      <div className="mt-4 rounded-xl border border-surface-border bg-surface-container-lowest p-5">
        <p className="mb-1 font-semibold text-text-navy">Location tracking</p>
        <p className="text-xs text-on-surface-variant">
          {telemetry.background
            ? "Background tracking is active during your shift hours."
            : "Tracking runs only while the app is open."}
        </p>
        <p className="mt-1 text-xs text-on-surface-variant">{telemetry.reason}</p>
        {battery?.needed && (
          <p className="mt-2 text-xs text-warning-amber">
            Your device may restrict background activity. See {battery.guidanceUrl}.
          </p>
        )}
      </div>

      <button
        onClick={() => {
          stopTelemetry();
          clearAccessToken();
          dispatch({ type: "LOGOUT" });
        }}
        className="mt-6 w-full rounded-lg border border-error py-3 font-semibold text-error"
      >
        Sign out
      </button>
    </div>
  );
}
