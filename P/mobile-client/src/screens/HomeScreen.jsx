import React from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../state/AppContext";
import BatteryOptimizationNotice from "../components/BatteryOptimizationNotice";
import BentoGrid from "../components/bento/BentoGrid";
import BentoTile from "../components/bento/BentoTile";
import TileHeader from "../components/bento/TileHeader";

function formatLogTime(iso) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatLogDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { day: "2-digit", month: "short" });
}

export default function HomeScreen() {
  const navigate = useNavigate();
  const { state, dispatch } = useApp();
  const { employee, office, checkedInAt, history } = state;

  if (!employee || !office) {
    // PROFILE_LOADED sets isAuthenticated at the same time as employee/office,
    // so this is only a brief render before that dispatch lands, not a real
    // steady state — no need for a full loading screen.
    return null;
  }

  return (
    <div className="px-5 pb-28 pt-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-text-navy">
            Hi, {employee.name}
          </h1>
          <p className="text-sm text-on-surface-variant">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-container font-display text-sm font-bold text-white">
          {employee.initials}
        </div>
      </div>

      <BentoGrid className="mt-6">
        <BentoTile rank="hero" className="border-ai-accent">
          <TileHeader
            title={checkedInAt ? "Active session" : "Not checked in"}
          />
          <div className="flex flex-1 flex-col px-4 pb-4">
            <p className="font-display text-lg text-ink">
              {checkedInAt
                ? `Checked in at ${checkedInAt.toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}`
                : "Shift starts 9:00 AM"}
            </p>
            <p className="mt-1 text-xs text-ink-muted">{office.name}</p>

            {/* bg-primary-container, not bg-text-navy: text-navy is now a TEXT-role
                alias (near-white in the dark-default theme, N42's lesson) — the
                same primary-action button colour already used by every other CTA
                in this app (LoginScreen, CheckInScreen) keeps real contrast. */}
            <button
              onClick={() => (checkedInAt ? dispatch({ type: "CHECK_OUT" }) : navigate("/check-in"))}
              data-interactive
              className="mt-4 w-full rounded-lg bg-primary-container py-3 font-semibold text-white"
            >
              {checkedInAt ? "Check out" : "Check in"}
            </button>
          </div>
        </BentoTile>

        <BentoTile rank="wide">
          <TileHeader title="Recent check-ins" />
          <div className="mt-2">
            {history.length === 0 && (
              <p className="p-4 text-center text-xs text-ink-muted">No check-ins yet.</p>
            )}
            {history.slice(0, 5).map((h) => (
              <div
                key={h._id}
                className="flex items-center justify-between border-t border-hairline px-4 py-3"
              >
                <div>
                  <p className="flex flex-wrap items-baseline gap-x-1.5 font-semibold text-ink">
                    <span>{h.checkType === "check_out" ? "Check-out" : "Check-in"}</span>
                    <span className="font-mono text-xs font-normal text-ink-muted">
                      {formatLogTime(h.timestamp)}
                    </span>
                  </p>
                  <p className="text-xs text-ink-muted">{formatLogDate(h.timestamp)}</p>
                </div>
                <span
                  className={`font-mono text-[11px] uppercase ${
                    h.status === "approved"
                      ? "text-success-emerald"
                      : h.status === "flagged"
                        ? "text-warning-amber"
                        : "text-ink-muted"
                  }`}
                >
                  {h.score != null ? `${h.score}%` : h.status}
                </span>
              </div>
            ))}
          </div>
        </BentoTile>
      </BentoGrid>

      <BatteryOptimizationNotice />
    </div>
  );
}
