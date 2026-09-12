import React from "react";

export default function StatusPill({ label, tone = "neutral", title }) {
  const tones = {
    ok: "border-success-emerald text-success-emerald bg-surface-container-lowest",
    bad: "border-error text-error bg-surface-container-lowest",
    warn: "border-warning-amber text-warning-amber bg-surface-container-lowest",
    neutral: "border-secondary-container text-text-navy bg-surface-container-lowest",
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide ${tones[tone]}`}
    >
      {label}
    </span>
  );
}
