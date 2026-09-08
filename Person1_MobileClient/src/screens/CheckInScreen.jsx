import React, { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../state/AppContext";
import PinPad from "../components/PinPad";
import StatusPill from "../components/StatusPill";
import BentoGrid from "../components/bento/BentoGrid";
import BentoTile from "../components/bento/BentoTile";
import { runCheckin, CHECKIN_STEPS } from "../lib/checkinService";
import { watchPosition, clearWatch, ensureLocationPermission } from "../lib/hardware";
import { distanceMeters, isInsideGeofence } from "../lib/geofence";
import { getTelemetryCapability } from "../lib/backgroundTelemetry";
import { FLASH_HEX, FLASH_DURATION_MS, captureFrameBase64, pickChallengeColors, sleep } from "../lib/liveness";

/**
 * One label per step the service actually emits.
 *
 * This map previously had no `uploading` entry even though
 * checkinService.js emits `onStep("uploading")`, so the primary button rendered
 * COMPLETELY BLANK for the whole S3 upload — the slowest step on mobile data,
 * and the one where an employee is most likely to think the app has hung and
 * kill it mid-check-in. `submitting` was also mislabelled "Uploading…", so the
 * two steps were named for each other.
 *
 * The assertion below keys the map against the service's own exported step list
 * so the two can never silently diverge again — a missing label is now a loud
 * failure at module load in development, not an invisible blank button in
 * production.
 */
export const STEP_LABELS = {
  permissions: "Checking permissions…",
  locating: "Getting GPS fix…",
  geofence: "Verifying you're on site…",
  antispoof: "Checking location integrity…",
  capture: "Opening camera…",
  liveness: "Confirming liveness…",
  compressing: "Compressing photo…",
  uploading: "Uploading photo…",
  submitting: "Submitting check-in…",
};

if (import.meta.env?.DEV) {
  const missing = CHECKIN_STEPS.filter((step) => !STEP_LABELS[step]);
  if (missing.length > 0) {
    // Loud on purpose: the failure mode this replaces was a silently blank CTA.
    console.error(`CheckInScreen: no STEP_LABELS entry for step(s): ${missing.join(", ")}`);
  }
}

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
  const [flashColor, setFlashColor] = useState(null); // active-illumination challenge overlay
  // React 18 concurrent rendering (Item 10, Flawless/Ultra blueprint): mounting
  // the full-screen result overlay after a slow AI-service round trip is real
  // render work. Wrapping it in a transition lets the busy indicator clear
  // immediately (a plain, high-priority update below) without waiting on it.
  const [, startResultTransition] = useTransition();

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
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
  // Real active-illumination Presentation Attack Detection signal (Item 3,
  // Flawless/Ultra blueprint) — NOT ISO/IEC 30107-3 certified, which needs a
  // real accredited physical lab this project has no access to. The screen
  // flashes 2 randomized colors while the front camera captures one frame
  // per flash; the AI service (POST /v1/liveness/challenge) is the sole
  // authority on pass/fail — this function only captures frames, it never
  // decides liveness itself. Returns [] (fails closed server-side, since the
  // server requires 2-4 frames) if no camera stream is available at all.
  const runLiveness = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return [];

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    } catch {
      return [];
    }

    try {
      const video = videoRef.current;
      // The user can navigate away/unmount between the getUserMedia await
      // above resolving and this line running — videoRef.current can
      // legitimately be null here. Same fail-closed behavior as "no camera
      // stream at all" (line 109/114): stop the track (finally, below) and
      // return no frames rather than crash the whole check-in flow on a
      // component that's no longer mounted.
      if (!video) return [];
      video.srcObject = stream;
      await video.play();

      const colors = pickChallengeColors();
      const frames = [];
      for (const color of colors) {
        setFlashColor(color);
        // eslint-disable-next-line no-await-in-loop -- each frame must be captured *after* its own flash, in sequence
        await sleep(FLASH_DURATION_MS);
        frames.push({ color, image: { kind: "base64", value: captureFrameBase64(video, canvasRef.current) } });
      }
      return frames;
    } finally {
      setFlashColor(null);
      stream.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    }
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

      startResultTransition(() => {
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
      });
    } catch (err) {
      if (mountedRef.current) {
        startResultTransition(() => {
          setResult({
            kind: "error",
            title: "Something went wrong",
            message: "Check-in couldn't be completed. Please try again.",
            score: null,
          });
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
  const headerId = useId();

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
          <h1 id={headerId} className="font-display text-xl font-semibold text-text-navy">
            {employee.fullName}
          </h1>
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

      <BentoGrid className="mt-5">
        <BentoTile rank="hero" className="!border-0 !bg-transparent !p-0" labelledBy={headerId}>
          {/* status pills */}
          <div className="flex flex-wrap justify-center gap-2">
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
                <p className="flex flex-wrap justify-center gap-x-1.5 text-center font-mono text-[10px] text-white">
                  <span>
                    {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
                  </span>
                  <span>{Math.round(metres)}m</span>
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
            data-interactive
            className="mt-8 w-full rounded-xl bg-primary-container py-4 font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? (step ? STEP_LABELS[step] : "Working…") : "Start Check-In"}
          </button>
          {!inside && position && (
            <p className="mt-2 text-center text-xs text-error">
              You must be within {office.radiusMeters}m of {office.name} to check in.
            </p>
          )}
        </BentoTile>
      </BentoGrid>

      {/* liveness capture: off-screen video/canvas the camera stream and frame grabs use */}
      <video ref={videoRef} muted playsInline className="absolute h-px w-px opacity-0" aria-hidden="true" />
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

      {/* active-illumination liveness overlay — a real PAD signal, not a tap-to-confirm placeholder */}
      {flashColor && (
        <div
          data-testid="liveness-flash"
          data-color={flashColor}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 text-black"
          style={{ backgroundColor: FLASH_HEX[flashColor] }}
        >
          <p className="font-display text-2xl">Hold steady</p>
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
