import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Range control built on the native input so keyboard and touch behaviour are
 * correct without a headless-UI dependency. Used for the geofence radius.
 */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onValueChange,
  className,
  'aria-label': ariaLabel,
  id,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (value: number) => void;
  className?: string;
  'aria-label'?: string;
  id?: string;
}) {
  const percent = ((value - min) / (max - min)) * 100;

  return (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onValueChange(Number(event.target.value))}
      className={cn(
        'h-6 w-full cursor-pointer appearance-none bg-transparent',
        '[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full',
        '[&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4',
        '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full',
        '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white',
        '[&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(15,27,45,0.35)]',
        '[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-line',
        '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full',
        '[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-accent',
        className,
      )}
      style={{
        background: 'transparent',
        // Track fill via a gradient so the filled portion reads as a value.
        backgroundImage: `linear-gradient(to right, var(--color-accent) ${percent}%, var(--color-line) ${percent}%)`,
        backgroundSize: '100% 6px',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        borderRadius: '999px',
      }}
    />
  );
}
