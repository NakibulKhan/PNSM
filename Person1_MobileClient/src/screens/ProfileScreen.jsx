import React from "react";
import { useApp } from "../state/AppContext";
import { clearAccessToken } from "../lib/http";
import { logoutMobile } from "../lib/api";
import { stopTelemetry, getTelemetryCapability } from "../lib/backgroundTelemetry";
import BatteryOptimizationNotice from "../components/BatteryOptimizationNotice";
import BentoGrid from "../components/bento/BentoGrid";
import BentoTile from "../components/bento/BentoTile";
import TileHeader from "../components/bento/TileHeader";

export default function ProfileScreen() {
  const { state, dispatch } = useApp();
  const telemetry = getTelemetryCapability();

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

      <BentoGrid>
        <BentoTile rank="square">
          <div className="flex flex-1 flex-col p-4">
            <p className="font-semibold text-ink">{state.employee.fullName}</p>
            <p className="font-mono text-xs text-ink-muted">{state.employee.employeeCode}</p>
            {state.employee.department && (
              <p className="mt-1 text-xs text-ink-muted">{state.employee.department}</p>
            )}
          </div>
        </BentoTile>

        {/* Assigned by HR — an employee no longer picks their own office here,
            since GET /api/mobile/me returns the real assignment and check-in
            needs a real geofence_id, not a client-chosen one (DECISIONS.md N4). */}
        <BentoTile rank="square">
          <TileHeader title="Assigned office" />
          <div className="flex-1 p-4 pt-2">
            <p className="text-ink">{state.office.name}</p>
            <p className="mt-2 font-mono text-xs text-ink-muted">
              Radius {state.office.radiusMeters}m
            </p>
          </div>
        </BentoTile>

        {state.shift && (
          <BentoTile rank="square">
            <TileHeader title="Shift" />
            <div className="flex-1 p-4 pt-2">
              <p className="flex flex-wrap items-baseline gap-x-2 text-ink">
                <span>{state.shift.label}</span>
                <span className="font-mono text-xs text-ink-muted">
                  {String(state.shift.startHour).padStart(2, "0")}:00–
                  {String(state.shift.endHour).padStart(2, "0")}:00
                </span>
              </p>
            </div>
          </BentoTile>
        )}

        {/* Employees are entitled to see whether they are being tracked. */}
        <BentoTile rank="square">
          <TileHeader title="Location tracking" />
          <div className="flex-1 p-4 pt-2">
            <p className="text-xs text-ink-muted">
              {telemetry.background
                ? "Background tracking is active during your shift hours."
                : "Tracking runs only while the app is open."}
            </p>
            <p className="mt-1 text-xs text-ink-muted">{telemetry.reason}</p>
            <BatteryOptimizationNotice dismissible={false} />
          </div>
        </BentoTile>
      </BentoGrid>

      <button
        onClick={signOut}
        className="mt-6 w-full rounded-lg border border-error py-3 font-semibold text-error"
      >
        Sign out
      </button>
    </div>
  );
}
