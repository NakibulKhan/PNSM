import React from "react";

/** The `.bento` grid container (styles/bento.css). Reading order equals DOM order. */
export default function BentoGrid({ children, className = "" }) {
  return <div className={`bento ${className}`}>{children}</div>;
}
