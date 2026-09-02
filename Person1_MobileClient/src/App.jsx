import React, { useEffect } from "react";
import { HashRouter, Routes, Route, Navigate, NavLink } from "react-router-dom";
import { AppProvider, useApp } from "./state/AppContext";
import { setSessionExpiredHandler } from "./lib/http";
import { startTelemetry, stopTelemetry } from "./lib/backgroundTelemetry";
import LoginScreen from "./screens/LoginScreen";
import HomeScreen from "./screens/HomeScreen";
import CheckInScreen from "./screens/CheckInScreen";
import ProfileScreen from "./screens/ProfileScreen";

/**
 * HashRouter, not BrowserRouter.
 *
 * The blueprint documents the CloudFront 404-on-deep-link problem for the web
 * dashboard (Quadrant II) and solves it with an S3/CloudFront rewrite rule.
 * The Capacitor shell has the same class of problem for a different reason:
 * it serves the bundle from capacitor:// or https://localhost over a native
 * WebView with no server to rewrite paths, so a path-based route that the
 * WebView tries to resolve on reload can 404 against the local file provider.
 * HashRouter keeps all routing client-side and sidesteps it entirely, which
 * is the standard recommendation for Capacitor apps.
 */

function TabBar() {
  const tabs = [
    { to: "/", label: "Home", end: true },
    { to: "/check-in", label: "Check-in" },
    { to: "/profile", label: "Profile" },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-surface-border bg-surface-container-lowest pb-[env(safe-area-inset-bottom)]">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `flex-1 py-4 text-center font-mono text-[11px] uppercase tracking-wide ${
              isActive ? "text-primary-container font-semibold" : "text-outline"
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

function Shell() {
  const { state, dispatch } = useApp();

  useEffect(() => {
    setSessionExpiredHandler(() => dispatch({ type: "LOGOUT" }));
  }, [dispatch]);

  useEffect(() => {
    if (state.isAuthenticated && state.employee) {
      startTelemetry({ employeeId: state.employee.id, shift: state.shift });
    } else {
      stopTelemetry();
    }
    return () => stopTelemetry();
    // state.employee starts null (AppContext.initialState) and is only ever
    // populated together with isAuthenticated (PROFILE_LOADED) — optional
    // chaining here is what keeps that transition from throwing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isAuthenticated, state.employee?.id, state.shift]);

  if (!state.isAuthenticated) {
    return (
      <Routes>
        <Route path="*" element={<LoginScreen />} />
      </Routes>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/check-in" element={<CheckInScreen />} />
        <Route path="/profile" element={<ProfileScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <TabBar />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </AppProvider>
  );
}
