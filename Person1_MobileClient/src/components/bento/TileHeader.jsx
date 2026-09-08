import React from "react";
import { useTileHeading } from "./BentoTile";

/** Title, one support line, one optional action — never a second heading. */
export default function TileHeader({ title, support, action }) {
  const { id, level: Level } = useTileHeading();

  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4">
      <div className="min-w-0">
        <Level id={id} className="truncate font-display text-[15px] font-semibold text-ink">
          {title}
        </Level>
        {support ? <p className="mt-0.5 text-[12px] text-ink-muted">{support}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
