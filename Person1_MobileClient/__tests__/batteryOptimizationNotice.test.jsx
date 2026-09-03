import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

const getPlatform = vi.fn();
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: (...args) => getPlatform(...args) } }));

const { default: BatteryOptimizationNotice } = await import("../src/components/BatteryOptimizationNotice");

describe("BatteryOptimizationNotice", () => {
  beforeEach(() => getPlatform.mockReset());
  afterEach(() => cleanup());

  it("renders nothing on web", () => {
    getPlatform.mockReturnValue("web");
    const { container } = render(<BatteryOptimizationNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing on iOS", () => {
    getPlatform.mockReturnValue("ios");
    const { container } = render(<BatteryOptimizationNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the note and a real clickable link on Android", () => {
    getPlatform.mockReturnValue("android");
    render(<BatteryOptimizationNotice />);
    expect(screen.getByText(/ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "https://dontkillmyapp.com" });
    expect(link).toHaveAttribute("href", "https://dontkillmyapp.com");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("is dismissible by default, and disappears once dismissed", () => {
    getPlatform.mockReturnValue("android");
    render(<BatteryOptimizationNotice />);
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "https://dontkillmyapp.com" })).not.toBeInTheDocument();
  });

  it("has no dismiss button when dismissible=false (ProfileScreen usage)", () => {
    getPlatform.mockReturnValue("android");
    render(<BatteryOptimizationNotice dismissible={false} />);
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://dontkillmyapp.com" })).toBeInTheDocument();
  });
});
