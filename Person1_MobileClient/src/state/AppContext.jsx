import React, { createContext, useContext, useMemo, useReducer } from "react";

/**
 * DECISIONS.md N4 — replaces the earlier hardcoded demo employee/office/
 * history with a real fetch from GET /api/mobile/me, which now exists on
 * the real backend (PNSM_Khan_Edit/Person3_BackendAPI). Nothing in this
 * file is mock data anymore; `initialState` is a genuine "nothing loaded
 * yet" state, not a demo seed.
 */

export const initialState = {
  isAuthenticated: false,
  loading: false,
  employee: null,
  office: null,
  shift: null,
  checkedInAt: null,
  history: [],
};

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function fmt(d) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

/**
 * Maps GET /api/mobile/me's response shape onto this app's flatter,
 * component-friendly shape. `office` merges the profile's separate
 * `office`/`geofence` objects — every screen that needs "where do I check
 * in" wants both together, and a real employee has exactly one assigned
 * geofence at a time in this system, so there is no information lost by
 * flattening them here.
 */
export function mapProfileToState(profile) {
  const office =
    profile.office && profile.geofence
      ? {
          key: profile.office._id,
          name: profile.office.office_name,
          address: profile.office.address,
          lat: profile.geofence.lat,
          lng: profile.geofence.lng,
          radiusMeters: profile.geofence.radius_meters,
          geofenceId: profile.geofence._id,
        }
      : null;

  return {
    employee: {
      id: profile.employee._id,
      name: profile.employee.name,
      fullName: profile.employee.name,
      initials: initials(profile.employee.name),
      employeeCode: profile.employee.employee_code,
      email: profile.employee.email,
      department: profile.employee.department,
      referencePhotoUrl: profile.employee.reference_photo_url,
    },
    office,
    shift: profile.shift
      ? {
          startHour: Number(profile.shift.start_time?.slice(0, 2) ?? 9),
          endHour: Number(profile.shift.end_time?.slice(0, 2) ?? 18),
          days: profile.shift.days_of_week ?? [],
          label: profile.shift.days_of_week_label ?? "",
        }
      : null,
    history: (profile.recent_logs ?? []).map((log) => ({
      _id: log._id,
      checkType: log.check_type,
      timestamp: log.timestamp,
      status: log.status,
      score: log.face_match_score,
    })),
  };
}

export function reducer(state, action) {
  switch (action.type) {
    case "LOADING":
      return { ...state, loading: true };
    case "PROFILE_LOADED": {
      const mapped = mapProfileToState(action.profile);
      return { ...state, ...mapped, isAuthenticated: true, loading: false };
    }
    case "LOGIN_FAILED":
      return { ...state, loading: false };
    case "LOGOUT":
      return { ...initialState };
    case "CHECK_IN_SUCCESS": {
      const { time, status, score, checkType } = action.payload;
      const record = {
        _id: `local-${time.getTime()}`,
        checkType,
        timestamp: time.toISOString(),
        status,
        score,
      };
      return {
        ...state,
        checkedInAt: checkType === "check_in" ? time : state.checkedInAt,
        history: [record, ...state.history].slice(0, 25),
      };
    }
    case "CHECK_OUT":
      // No dedicated backend call for check-out yet (ROADMAP.md Phase 3 only
      // wires the check-IN pipeline end to end) — this stays a local-only UI
      // state change, same as the original mock behaviour, until a real
      // check-out flow is scoped.
      return { ...state, checkedInAt: null };
    default:
      return state;
  }
}

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

export { fmt };
