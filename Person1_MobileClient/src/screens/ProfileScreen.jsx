import React from "react";
import { useApp } from "../state/AppContext";
import { clearAccessToken } from "../lib/http";
import { logoutMobile } from "../lib/api";
import { stopTelemetry, getTelemetryCapability, getBatteryOptimizationGuidance } from "../lib/backgroundTelemetry";

export default function ProfileScreen() {
  const { state, dispatch } = useApp();
  const telemetry = getTelemetryCapability();
  const battery = getBatteryOptimizationGuidance();

  if (!state.employee || !state.office) return null;

  async function signOut() {
    stopTelemetry();
    await logoutMobile();
    clearAccessToken();
    dispatch({ type: "LOGOUT" });
  }

  return (
    <div className="px-5 pb-28 pt-8">
      <h1 className="mb-6 font-display text-2xl font-bold text-text-navy">Profile</h1>

      <div className="rounded-xl border border-surface-border bg-surface-container-lowest p-5">
        <p className="font-semibold text-text-navy">{state.employee.fullName}</p>
        <p className="font-mono text-xs text-on-surface-variant">{state.employee.employeeCode}</p>
        {state.employee.department && (
          <p className="mt-1 text-xs text-on-surface-variant">{state.employee.department}</p>
        )}
      </div>

      {/* Assigned by HR — an employee no longer picks their own office here,
          since GET /api/mobile/me returns the real assignment and check-in
          needs a real geofence_id, not a client-chosen one (DECISIONS.md N4). */}
      <div className="mt-4 rounded-xl border border-surface-border bg-surface-container-lowest p-5">
        <p className="mb-1 font-mono text-[11px] uppercase text-on-surface-variant">
          Assigned office
        </p>
        <p className="text-text-navy">{state.office.name}</p>
        <p className="mt-2 font-mono text-xs text-on-surface-variant">
          Radius {state.office.radiusMeters}m
        </p>
      </div>

      {state.shift && (
        <div className="mt-4 rounded-xl border border-surface-border bg-surface-container-lowest p-5">
          <p className="mb-1 font-mono text-[11px] uppercase text-on-surface-variant">Shift</p>
          <p className="text-text-navy">
            {state.shift.label} · {String(state.shift.startHour).padStart(2, "0")}:00–
            {String(state.shift.endHour).padStart(2, "0")}:00
          </p>
        </div>
      )}

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
        onClick={signOut}
        className="mt-6 w-full rounded-lg border border-error py-3 font-semibold text-error"
      >
        Sign out
      </button>
    </div>
  );
}
