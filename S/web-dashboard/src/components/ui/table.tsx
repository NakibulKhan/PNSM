import * as React from 'react';
import { cn } from '@/lib/utils';

export function TableShell({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('scrollbar-slim w-full overflow-x-auto', className)}>
      <table className="w-full min-w-[720px] text-left">{children}</table>
    </div>
  );
}

export function Th({
  className,
  align = 'left',
  children,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      scope="col"
      className={cn(
        'eyebrow sticky top-0 z-1 whitespace-nowrap border-b border-line bg-canvas px-3 py-2',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function Td({
  className,
  align = 'left',
  children,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <td
      className={cn(
        'border-b border-line px-3 py-2.5 text-[13px] align-middle',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-canvas/70', className)} {...props} />;
}
