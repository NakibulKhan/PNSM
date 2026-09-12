import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

/**
 * M5 (master audit): "one migrated screen per app." ProfileScreen is fully
 * Bento-migrated (four `rank="square"` tiles) and had no render coverage.
 * Building this test surfaced a real bug: the identity-card tile rendered no
 * heading element at all, so its `aria-labelledby` pointed at an id nothing
 * in the DOM carried — fixed in the same change as this test (ProfileScreen.jsx).
 */
const getPlatform = vi.fn();
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: (...args) => getPlatform(...args) } }));

const useApp = vi.fn();
vi.mock("../src/state/AppContext", () => ({ useApp: (...args) => useApp(...args) }));

vi.mock("../src/lib/http", () => ({ clearAccessToken: vi.fn() }));
vi.mock("../src/lib/api", () => ({ logoutMobile: vi.fn().mockResolvedValue(undefined) }));

const { default: ProfileScreen } = await import("../src/screens/ProfileScreen");

const employee = {
  fullName: "Rafiq Alam",
  employeeCode: "PNSM-0108",
  department: "Engineering",
};
const office = { name: "Gulshan Office", radiusMeters: 60 };
const shift = { label: "Sun-Thu", startHour: 9, endHour: 18 };

describe("ProfileScreen (migrated Bento screen)", () => {
  beforeEach(() => {
    getPlatform.mockReturnValue("web");
    useApp.mockReturnValue({
      state: { employee, office, shift },
      dispatch: vi.fn(),
    });
  });
  afterEach(() => cleanup());

  it("renders nothing while employee/office have not loaded yet", () => {
    useApp.mockReturnValue({ state: {}, dispatch: vi.fn() });
    const { container } = render(<ProfileScreen />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the correct a11y heading outline: the page h1 plus one h3 per tile", () => {
    render(<ProfileScreen />);
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toBeInTheDocument();

    const h3s = screen.getAllByRole("heading", { level: 3 });
    const h3Texts = h3s.map((h) => h.textContent);
    // The identity card's heading IS the employee's name (no separate title).
    expect(h3Texts).toEqual(
      expect.arrayContaining(["Rafiq Alam", "Assigned office", "Shift", "Location tracking"]),
    );
  });

  it("every tile's aria-labelledby resolves to a real heading in the document", () => {
    render(<ProfileScreen />);
    const regions = screen.getAllByRole("region");
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      const labelId = region.getAttribute("aria-labelledby");
      expect(labelId).toBeTruthy();
      expect(document.getElementById(labelId)).not.toBeNull();
    }
  });

  it("renders the employee's identity, office, and shift details", () => {
    render(<ProfileScreen />);
    expect(screen.getByText("PNSM-0108")).toBeInTheDocument();
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("Gulshan Office")).toBeInTheDocument();
    expect(screen.getByText("Radius 60m")).toBeInTheDocument();
  });

  it("omits the Shift tile when there is no shift assigned", () => {
    useApp.mockReturnValue({ state: { employee, office, shift: null }, dispatch: vi.fn() });
    render(<ProfileScreen />);
    expect(screen.queryByRole("heading", { name: "Shift" })).not.toBeInTheDocument();
  });

  it("signs out through the real lib calls when Sign out is clicked", async () => {
    const { clearAccessToken } = await import("../src/lib/http");
    const { logoutMobile } = await import("../src/lib/api");
    const dispatch = vi.fn();
    useApp.mockReturnValue({ state: { employee, office, shift }, dispatch });

    render(<ProfileScreen />);
    screen.getByRole("button", { name: "Sign out" }).click();

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "LOGOUT" }));
    expect(logoutMobile).toHaveBeenCalled();
    expect(clearAccessToken).toHaveBeenCalled();
  });
});
