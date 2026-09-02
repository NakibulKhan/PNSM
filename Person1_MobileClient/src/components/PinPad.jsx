import React from "react";

/**
 * Numeric PIN entry. Uses the .pnsm-keypad class so the Safari 16.3
 * @supports fallback in index.css can swap grid for flexbox on legacy WebKit.
 */
export default function PinPad({ value, onChange, length = 4, disabled = false }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];

  function press(k) {
    if (disabled || k === "") return;
    if (k === "back") onChange(value.slice(0, -1));
    else if (value.length < length) onChange(value + k);
  }

  return (
    <div>
      <div className="flex justify-center gap-4 mb-6" aria-label="PIN entry progress">
        {Array.from({ length }).map((_, i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full border ${
              i < value.length
                ? "bg-primary-container border-primary-container"
                : "bg-surface-container border-outline-variant"
            }`}
          />
        ))}
      </div>
      <div className="pnsm-keypad max-w-xs mx-auto">
        {keys.map((k, i) => (
          <button
            key={i}
            type="button"
            disabled={disabled || k === ""}
            onClick={() => press(k)}
            aria-label={k === "back" ? "Delete last digit" : k || undefined}
            className={
              k === ""
                ? "h-16 invisible"
                : "h-16 rounded-full bg-surface-container-low font-display text-xl text-primary active:scale-90 transition disabled:opacity-40"
            }
          >
            {k === "back" ? "⌫" : k}
          </button>
        ))}
      </div>
    </div>
  );
}
