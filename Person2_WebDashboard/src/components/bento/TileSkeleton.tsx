import { Skeleton } from '@/components/ui/skeleton';

/**
 * Fills the tile's already-reserved grid cell (the `rank-*` span on the
 * parent `BentoTile`) — nothing shifts when real content replaces it
 * (master prompt §3 rule 6).
 */
export function TileSkeleton() {
  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-full w-full flex-1" />
    </div>
  );
}
