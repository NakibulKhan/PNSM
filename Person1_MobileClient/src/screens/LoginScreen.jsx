import React, { useState } from "react";
import { useApp } from "../state/AppContext";
import { setAccessToken } from "../lib/http";
import { MOCK_BACKEND } from "../lib/api";

export default function LoginScreen() {
  const { dispatch } = useApp();
  const [id, setId] = useState("EMP-2431");
  const [password, setPassword] = useState("demo1234");
  const [pin, setPin] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!id.trim() || !password.trim()) return setError("Enter your ID and password.");
    if (pin.length < 4) return setError("Enter your 4-digit 2FA PIN.");
    setError(null);
    setBusy(true);
    try {
      if (MOCK_BACKEND) {
        // Demo only. Real login POSTs {id, password, pin} to /api/auth/login,
        // which returns the access token and sets the HttpOnly refresh cookie.
        // Credentials are never validated on the client in production.
        if (pin !== "4821") throw new Error("Incorrect PIN.");
        setAccessToken("mock-access-token");
        dispatch({ type: "LOGIN" });
      }
    } catch (e) {
      setError(e.message ?? "Sign-in failed.");
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
          value={id}
          onChange={(e) => setId(e.target.value)}
          className="mb-4 w-full rounded-lg border border-surface-border bg-surface-bright px-3 py-3"
        />

        <label className="mb-1 block font-mono text-[11px] uppercase text-on-surface-variant">
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-lg border border-surface-border bg-surface-bright px-3 py-3"
        />

        <label className="mb-1 block font-mono text-[11px] uppercase text-on-surface-variant">
          2FA PIN <span className="normal-case text-on-surface-variant">(demo: 4821)</span>
        </label>
        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          className="w-full rounded-lg border border-surface-border bg-surface-bright px-3 py-3 text-center font-mono text-lg tracking-[0.5em]"
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
