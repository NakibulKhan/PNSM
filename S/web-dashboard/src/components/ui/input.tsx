import * as React from 'react';
import { cn } from '@/lib/utils';

const fieldBase =
  'w-full rounded-sm border bg-surface px-3 text-[13px] text-ink placeholder:text-faint ' +
  'transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 ' +
  'disabled:cursor-not-allowed disabled:bg-canvas disabled:text-faint';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Set true for measured values so digits align. */
  numeric?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, numeric, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        fieldBase,
        'h-9',
        numeric && 'tnum',
        invalid ? 'border-rejected' : 'border-line-strong',
        className,
      )}
      {...props}
    />
  );
});

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, 'h-9 pr-8', invalid ? 'border-rejected' : 'border-line-strong', className)}
      {...props}
    >
      {children}
    </select>
  );
});

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="eyebrow mb-1.5 block">
        {label}
        {required ? <span className="ml-1 text-rejected">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11.5px] font-medium text-rejected">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11.5px] text-faint">{hint}</span>
      ) : null}
    </label>
  );
}
