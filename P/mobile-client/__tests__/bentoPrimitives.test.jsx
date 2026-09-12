import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * M5 (master audit): this app's Bento primitives had no render coverage.
 * Person2_WebDashboard's equivalent test caught real drift (M1: three
 * consumers silently broke the h2/h3 heading contract) — this mirrors it for
 * Person1's own BentoTile/TileHeader/BentoGrid so the same class of
 * regression can't land here unnoticed either.
 */
const { default: BentoGrid } = await import("../src/components/bento/BentoGrid");
const { default: BentoTile, useTileHeading } = await import("../src/components/bento/BentoTile");
const { default: TileHeader } = await import("../src/components/bento/TileHeader");

function HeadingProbe() {
  const { id, level } = useTileHeading();
  return (
    <p data-testid="probe" data-id={id} data-level={level}>
      probe
    </p>
  );
}

describe("BentoTile", () => {
  it("renders a hero tile as a section labelled by its own h2", () => {
    render(
      <BentoTile rank="hero">
        <HeadingProbe />
      </BentoTile>,
    );
    const region = screen.getByRole("region");
    const probe = screen.getByTestId("probe");
    expect(probe.dataset.level).toBe("h2");
    expect(region).toHaveAttribute("aria-labelledby", probe.dataset.id);
  });

  it("renders every non-hero rank as a section labelled by its own h3", () => {
    for (const rank of ["wide", "tall", "square", "chip", "rail"]) {
      const { unmount } = render(
        <BentoTile rank={rank}>
          <HeadingProbe />
        </BentoTile>,
      );
      expect(screen.getByTestId("probe").dataset.level).toBe("h3");
      unmount();
    }
  });

  it("carries the rank as a class name for the CSS grid engine to key off", () => {
    render(
      <BentoTile rank="wide">
        <HeadingProbe />
      </BentoTile>,
    );
    expect(screen.getByRole("region").className).toContain("rank-wide");
  });

  it("labelledBy lets a tile defer to a heading that already exists outside it", () => {
    render(
      <div>
        <h1 id="screen-heading">Home</h1>
        <BentoTile rank="hero" labelledBy="screen-heading">
          <p>content, no internal heading</p>
        </BentoTile>
      </div>,
    );
    expect(screen.getByRole("region")).toHaveAttribute("aria-labelledby", "screen-heading");
  });

  it("useTileHeading throws outside a BentoTile", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<HeadingProbe />)).toThrow("useTileHeading must be used within a BentoTile");
    spy.mockRestore();
  });
});

describe("TileHeader", () => {
  it("renders the title as the tile heading, at the level BentoTile assigned", () => {
    render(
      <BentoTile rank="square">
        <TileHeader title="Assigned office" />
      </BentoTile>,
    );
    const heading = screen.getByRole("heading", { level: 3, name: "Assigned office" });
    expect(screen.getByRole("region")).toHaveAttribute("aria-labelledby", heading.id);
  });

  it("renders support and action when passed (L5: not currently used by any screen, but must still work)", () => {
    render(
      <BentoTile rank="chip">
        <TileHeader title="Shift" support="09:00 - 18:00" action={<span>Edit</span>} />
      </BentoTile>,
    );
    expect(screen.getByText("09:00 - 18:00")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });
});

describe("BentoGrid", () => {
  it("renders its children inside the .bento grid container", () => {
    const { container } = render(
      <BentoGrid>
        <div data-testid="child">content</div>
      </BentoGrid>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(container.querySelector(".bento")).toBeInTheDocument();
  });
});
