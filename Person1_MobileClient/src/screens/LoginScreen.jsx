import React, { useState } from "react";
import { useApp } from "../state/AppContext";
import { loginMobile, fetchMobileProfile } from "../lib/api";

/**
 * DECISIONS.md N3 — password only. The PIN field that used to live here was
 * never backed by any documented backend login check (Person 4's PIN
 * verification is documented only as step 2 of the check-in sequence, never
 * login) — it stayed a client-side-only gate that happened to duplicate the
 * real PIN prompt on the check-in screen. Removed rather than left as dead
 * UI that implies a security check nothing on the backend performs.
 */
export default function LoginScreen() {
  const { dispatch } = useApp();
  const [employeeCode, setEmployeeCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!employeeCode.trim() || !password.trim()) {
      return setError("Enter your Employee ID and password.");
    }
    setError(null);
    setBusy(true);
    dispatch({ type: "LOADING" });
    try {
      await loginMobile(employeeCode.trim(), password);
      const profile = await fetchMobileProfile();
      dispatch({ type: "PROFILE_LOADED", profile });
    } catch (e) {
      dispatch({ type: "LOGIN_FAILED" });
      const reason = e.response?.data?.reason;
      if (reason === "account_inactive") {
        setError("This account has been deactivated. Contact HR.");
      } else {
        setError(e.response?.data?.error?.message ?? e.message ?? "Sign-in failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col justify-center px-6 py-10">
      <div className="mb-8 text-center">
        <h1 className="font-display text-4xl font-bold text-text-navy">PNSM</h1>
        <p className="mt-1 text-sm tracking-wide text-on-surface-variant">
          SECURE WORKFORCE PORTAL
        </p>
      </div>

      <div className="rounded-xl border border-surface-border bg-surface-container-lowest p-6">
        <label className="mb-1 block font-mono text-[11px] uppercase text-on-surface-variant">
          Employee ID
        </label>
        <input
          value={employeeCode}
          onChange={(e) => setEmployeeCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="mb-4 w-full rounded-lg border border-surface-border bg-surface-bright px-3 py-3"
        />

        <label className="mb-1 block font-mono text-[11px] uppercase text-on-surface-variant">
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full rounded-lg border border-surface-border bg-surface-bright px-3 py-3"
        />

        {error && <p className="mt-3 text-center text-sm text-error">{error}</p>}

        <button
          onClick={submit}
          disabled={busy}
          className="mt-5 w-full rounded-lg bg-primary-container py-4 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Authenticating…" : "Secure Login"}
        </button>
      </div>
    </div>
  );
}
