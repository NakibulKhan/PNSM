import React, { createContext, useContext, useMemo, useReducer } from "react";
import { OFFICES } from "../lib/geofence";

const employee = {
  id: "EMP-2431",
  name: "Mehnaz Afrida",
  fullName: "Mehnaz Afrida Chowdhury",
  initials: "MA",
};

const initialHistory = [
  { date: "2026-08-30", office: "PNSM HQ", inT: "9:02 AM", outT: "6:08 PM", status: "approved", score: 96 },
  { date: "2026-08-29", office: "PNSM HQ", inT: "9:14 AM", outT: "6:01 PM", status: "flagged", score: 78 },
  { date: "2026-08-28", office: "PNSM HQ", inT: "8:58 AM", outT: "6:05 PM", status: "approved", score: 98 },
];

export const initialState = {
  isAuthenticated: false,
  employee,
  office: OFFICES.hq,
  checkedInAt: null,
  history: initialHistory,
  shift: { startHour: 9, endHour: 18, days: [1, 2, 3, 4, 5] },
};

function fmt(d) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

export function reducer(state, action) {
  switch (action.type) {
    case "LOGIN":
      return { ...state, isAuthenticated: true };
    case "LOGOUT":
      return { ...state, isAuthenticated: false, checkedInAt: null };
    case "SET_OFFICE":
      return { ...state, office: action.office };
    case "CHECK_IN_SUCCESS": {
      const { time, status, score } = action.payload;
      const date = time.toISOString().slice(0, 10);
      const record = {
        date,
        office: state.office.name.split(" — ")[0],
        inT: fmt(time),
        outT: null,
        status,
        score,
      };
      const idx = state.history.findIndex((h) => h.date === date);
      const history =
        idx >= 0
          ? state.history.map((h, i) => (i === idx ? { ...h, ...record } : h))
          : [record, ...state.history];
      return { ...state, checkedInAt: time, history };
    }
    case "CHECK_OUT": {
      const time = new Date();
      const date = time.toISOString().slice(0, 10);
      return {
        ...state,
        checkedInAt: null,
        history: state.history.map((h) => (h.date === date ? { ...h, outT: fmt(time) } : h)),
      };
    }
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
