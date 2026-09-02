import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../state/AppContext";
import PinPad from "../components/PinPad";
import StatusPill from "../components/StatusPill";
import { runCheckin } from "../lib/checkinService";
import { watchPosition, clearWatch, ensureLocationPermission } from "../lib/hardware";
import { distanceMeters, isInsideGeofence } from "../lib/geofence";
import { getTelemetryCapability } from "../lib/backgroundTelemetry";

const LIVENESS_WINDOW_MS = 3000;

const STEP_LABELS = {
  permissions: "Checking permissions…",
  locating: "Getting GPS fix…",
  geofence: "Verifying you're on site…",
  antispoof: "Checking location integrity…",
  capture: "Opening camera…",
  liveness: "Confirming liveness…",
  compressing: "Compressing photo…",
  submitting: "Uploading…",
};

const RESULT_STYLES = {
  success: { ring: "bg-success-emerald/10 text-success-emerald", icon: "✓" },
  review: { ring: "bg-warning-container text-warning-amber", icon: "!" },
  rejected: { ring: "bg-error-container text-error", icon: "✕" },
  // Transient/system problems are deliberately NOT red: a dead network is not
  // the employee's fault and shouldn't look like a rejection.
  error: { ring: "bg-surface-container-high text-secondary", icon: "⌁" },
  blocked: { ring: "bg-surface-container-high text-secondary", icon: "⚙" },
  cancelled: { ring: "bg-surface-container-high text-on-surface-variant", icon: "—" },
};

export default function CheckInScreen() {
  const navigate = useNavigate();
  const { state, dispatch } = useApp();
  // App.jsx only mounts this screen once isAuthenticated is true, which
  // PROFILE_LOADED sets at the same time as employee/office — both are
  // always populated by the time this component renders.
  const { office, employee } = state;

  const [now, setNow] = useState(new Date());
  const [position, setPosition] = useState(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(null);
  const [result, setResult] = useState(null);
  const [livenessPrompt, setLivenessPrompt] = useState(null); // {resolve}

  const inFlightRef = useRef(false);
  const watchIdRef = useRef(null);
  const mountedRef = useRef(true);

  /* ------------------------------------------------------------- clock */
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* --------------------------------------------------- live GPS badge */
  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      const perm = await ensureLocationPermission();
      if (!mountedRef.current) return;
      if (!perm.granted) {
        setLocationDenied(true);
        return;
      }
      const id = await watchPosition(
        (p) => mountedRef.current && setPosition(p),
        () => {}
      );
      watchIdRef.current = id;
    })();

    return () => {
      mountedRef.current = false;
      // Leaving the GNSS watch running would keep the chip hot and drain
      // the battery for as long as the app is open.
      clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    };
  }, []);

  const metres = position
    ? distanceMeters(position.lat, position.lng, office.lat, office.lng)
    : null;
  const inside = position ? isInsideGeofence(position.lat, position.lng, office) : false;

  /* ---------------------------------------------------------- liveness */
  // Resolves true when the employee taps within the window, or when the
  // window elapses. See README: this is a timed confirmation, not ML blink
  // detection, and is documented as such.
  const runLiveness = useCallback(() => {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => {
        if (settled) return;
        settled = true;
        setLivenessPrompt(null);
        resolve(v);
      };
      const timer = setTimeout(() => finish(true), LIVENESS_WINDOW_MS);
      setLivenessPrompt({
        confirm: () => {
          clearTimeout(timer);
          finish(true);
        },
      });
    });
  }, []);

  /* ------------------------------------------------------------ submit */
  const start = useCallback(async () => {
    if (inFlightRef.current) return; // double-tap guard
    inFlightRef.current = true;
    setBusy(true);
    setResult(null);

    try {
      const { outcome, response } = await runCheckin({
        office,
        employeeId: employee.id,
        pin,
        onStep: setStep,
        runLiveness,
      });

      if (!mountedRef.current) return;

      if (outcome.kind === "success" || outcome.kind === "review") {
        dispatch({
          type: "CHECK_IN_SUCCESS",
          payload: {
            time: new Date(),
            status: response.status,
            score: response.face_match_score,
            checkType: "check_in",
          },
        });
      }
      setResult({ ...outcome, score: response?.face_match_score ?? null });
    } catch (err) {
      if (mountedRef.current) {
        setResult({
          kind: "error",
          title: "Something went wrong",
          message: "Check-in couldn't be completed. Please try again.",
          score: null,
        });
      }
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) {
        setBusy(false);
        setStep(null);
      }
    }
  }, [office, employee.id, pin, runLiveness, dispatch]);

  function reset() {
    setResult(null);
    setPin("");
  }

  const telemetry = getTelemetryCapability();
  const canSubmit = inside && pin.length === 4 && !busy;

  /* -------------------------------------------------------- rendering */

  if (locationDenied) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="font-display text-xl text-text-navy">Location access required</p>
        <p className="text-sm text-on-surface-variant">
          PNSM needs your location to confirm you&apos;re at {office.name}.
        </p>
        <button
          onClick={async () => {
            const perm = await ensureLocationPermission();
            if (perm.granted) setLocationDenied(false);
          }}
          className="rounded-lg bg-primary-container px-5 py-3 font-semibold text-white"
        >
          Grant location permission
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col px-5 pb-28 pt-6">
      {/* identity + live clock */}
      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-navy">{employee.fullName}</h1>
          <p className="font-mono text-[11px] uppercase tracking-wide text-on-surface-variant">
            {employee.id}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm text-text-navy">
            {now.toLocaleTimeString("en-US", { hour12: false })}
          </p>
          <p className="font-mono text-[11px] text-on-surface-variant">
            {now.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" })}
          </p>
        </div>
      </header>

      {/* status pills */}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <StatusPill
          label={
            !position
              ? "Locating…"
              : inside
                ? "Geofence: verified"
                : "Geofence: out of range"
          }
          tone={!position ? "neutral" : inside ? "ok" : "bad"}
        />
        <StatusPill
          label={telemetry.background ? "Telemetry: background" : "Telemetry: foreground"}
          tone={telemetry.background ? "ok" : "warn"}
          title={telemetry.reason}
        />
      </div>

      {/* camera framing target */}
      <div className="relative mx-auto mt-6 h-56 w-56 overflow-hidden rounded-full border-[6px] border-surface-container-high bg-surface-container">
        <div className="pnsm-scan-line" />
        <div className="absolute inset-4 rounded-full border border-dashed border-outline-variant" />
        <div className="flex h-full items-center justify-center px-6 text-center">
          <p className="text-xs text-on-surface-variant">
            The native camera opens when you start check-in.
          </p>
        </div>
        {position && (
          <div className="absolute inset-x-0 bottom-0 bg-black/45 px-2 py-1">
            <p className="text-center font-mono text-[10px] text-white">
              {position.lat.toFixed(5)}, {position.lng.toFixed(5)} · {Math.round(metres)}m
            </p>
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-xs text-on-surface-variant">
        Accuracy ±{position ? Math.round(position.accuracy) : "—"}m · allowed radius{" "}
        {office.radiusMeters}m
      </p>

      {/* PIN */}
      <div className="mt-8">
        <p className="mb-4 text-center font-mono text-[11px] uppercase tracking-wide text-on-surface-variant">
          Enter your 2FA PIN
        </p>
        <PinPad value={pin} onChange={setPin} disabled={busy} />
      </div>

      {/* CTA */}
      <button
        onClick={start}
        disabled={!canSubmit}
        className="mt-8 w-full rounded-xl bg-primary-container py-4 font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
      >
        {busy ? (step ? STEP_LABELS[step] : "Working…") : "Start Check-In"}
      </button>
      {!inside && position && (
        <p className="mt-2 text-center text-xs text-error">
          You must be within {office.radiusMeters}m of {office.name} to check in.
        </p>
      )}

      {/* liveness overlay */}
      {livenessPrompt && (
        <div
          role="button"
          tabIndex={0}
          onClick={livenessPrompt.confirm}
          onKeyDown={livenessPrompt.confirm}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/70 text-white"
        >
          <p className="font-display text-2xl">Blink now</p>
          <p className="font-mono text-sm opacity-80">Tap to confirm</p>
        </div>
      )}

      {/* result */}
      {result && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white/97 p-8 text-center">
          <div
            className={`flex h-20 w-20 items-center justify-center rounded-full text-3xl ${
              RESULT_STYLES[result.kind]?.ring ?? RESULT_STYLES.error.ring
            }`}
          >
            {RESULT_STYLES[result.kind]?.icon ?? "?"}
          </div>
          <h2 className="font-display text-2xl text-text-navy">{result.title}</h2>
          <p className="max-w-xs text-sm text-on-surface-variant">{result.message}</p>

          {result.score != null && (
            <div className="rounded-xl border border-surface-border px-8 py-4">
              <p className="font-mono text-[11px] uppercase tracking-wide text-on-surface-variant">
                Face-match confidence
              </p>
              <p
                className={`font-display text-3xl ${
                  result.kind === "review" ? "text-warning-amber" : "text-success-emerald"
                }`}
              >
                {result.score}%
              </p>
            </div>
          )}

          <button
            onClick={() => {
              reset();
              navigate("/");
            }}
            className="mt-2 rounded-lg bg-primary-container px-8 py-3 font-semibold text-white"
          >
            Done
          </button>
          {(result.kind === "rejected" || result.kind === "error") && (
            <button onClick={reset} className="font-semibold text-text-navy">
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
