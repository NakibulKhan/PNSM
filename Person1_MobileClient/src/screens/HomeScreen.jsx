import React from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../state/AppContext";

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

      <section className="mt-6 rounded-xl border border-ai-accent bg-surface-container-lowest p-5">
        <p
          className={`font-mono text-[11px] uppercase tracking-wide ${
            checkedInAt ? "text-success-emerald" : "text-error"
          }`}
        >
          {checkedInAt ? "Active session" : "Not checked in"}
        </p>
        <p className="mt-1 font-display text-lg text-text-navy">
          {checkedInAt
            ? `Checked in at ${checkedInAt.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}`
            : "Shift starts 9:00 AM"}
        </p>
        <p className="mt-1 text-xs text-on-surface-variant">{office.name}</p>

        <button
          onClick={() => (checkedInAt ? dispatch({ type: "CHECK_OUT" }) : navigate("/check-in"))}
          className="mt-4 w-full rounded-lg bg-text-navy py-3 font-semibold text-white"
        >
          {checkedInAt ? "Check out" : "Check in"}
        </button>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 font-display text-lg text-text-navy">Recent check-ins</h2>
        <div className="rounded-xl border border-surface-border bg-surface-container-lowest">
          {history.length === 0 && (
            <p className="p-4 text-center text-xs text-on-surface-variant">No check-ins yet.</p>
          )}
          {history.slice(0, 5).map((h) => (
            <div
              key={h._id}
              className="flex items-center justify-between border-b border-surface-border p-4 last:border-b-0"
            >
              <div>
                <p className="font-semibold text-text-navy">
                  {h.checkType === "check_out" ? "Check-out" : "Check-in"} · {formatLogTime(h.timestamp)}
                </p>
                <p className="text-xs text-on-surface-variant">{formatLogDate(h.timestamp)}</p>
              </div>
              <span
                className={`font-mono text-[11px] uppercase ${
                  h.status === "approved"
                    ? "text-success-emerald"
                    : h.status === "flagged"
                      ? "text-warning-amber"
                      : "text-on-surface-variant"
                }`}
              >
                {h.score != null ? `${h.score}%` : h.status}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
