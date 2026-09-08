import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The `.bento` grid container (bento.css). Reading order equals DOM order —
 * children are placed in source order, never reordered via `order`/`dense`.
 */
export function BentoGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('bento', className)}>{children}</div>;
}
