import React, { createContext, useContext, useId } from "react";

const TileHeadingContext = createContext(null);

/** Read by TileHeader (or any tile rolling its own heading) to link `aria-labelledby`. */
export function useTileHeading() {
  const ctx = useContext(TileHeadingContext);
  if (!ctx) {
    throw new Error("useTileHeading must be used within a BentoTile");
  }
  return ctx;
}

/**
 * One Bento compartment. Never fetches or owns data — the caller passes
 * `children`. Hero tiles render an `h2` heading (master prompt §10, "hero is
 * h2 under the page h1"); every other rank renders `h3`.
 *
 * `labelledBy`: when a tile elaborates on a heading that already exists
 * outside it (e.g. a screen's own `<h1>`), pass that id instead of having the
 * tile generate and require its own internal heading — avoids an orphaned
 * `aria-labelledby` pointing at nothing when the tile has no `TileHeader`.
 */
export default function BentoTile({ rank, className = "", labelledBy, children }) {
  const headingId = useId();
  const level = rank === "hero" ? "h2" : "h3";
  const resolvedId = labelledBy ?? headingId;

  return (
    <TileHeadingContext.Provider value={{ id: resolvedId, level }}>
      <section aria-labelledby={resolvedId} className={`bento-tile rank-${rank} ${className}`}>
        {children}
      </section>
    </TileHeadingContext.Provider>
  );
}
