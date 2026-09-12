import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/states';
import { SkeletonRows } from '@/components/ui/skeleton';
import { GeofenceForm } from '@/components/forms/geofence-form';
import { RbacGate } from '@/components/common/rbac-gate';
import { BentoGrid } from '@/components/bento/BentoGrid';
import { BentoTile } from '@/components/bento/BentoTile';
import { TileHeader } from '@/components/bento/TileHeader';
import { fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import { formatLatLng, pointToLatLng } from '@/lib/geo';
import { cn } from '@/lib/utils';
import type { Geofence } from '@/types/models';

/** Office list on the left, editor tiles on the right, all in one Bento grid. */
export function GeofenceManager() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: queryKeys.geofences,
    queryFn: () => fetchData<Geofence[]>('geofences'),
  });

  const selected = data?.find((fence) => fence._id === selectedId) ?? null;
  const showForm = creating || Boolean(selected);

  return (
    <BentoGrid>
      <BentoTile rank="tall">
        <TileHeader
          title="Offices"
          support={data ? `${data.length} configured` : undefined}
          action={
            <RbacGate permission="geofence:write">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setCreating(true);
                  setSelectedId(null);
                }}
              >
                <Plus size={13} aria-hidden /> Add
              </Button>
            </RbacGate>
          }
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isPending ? (
            <SkeletonRows rows={4} className="p-3" />
          ) : !data || data.length === 0 ? (
            <EmptyState
              title="No geofences yet"
              message="Add an office and set the radius employees must check in within."
              icon={MapPin}
            />
          ) : (
            <ul>
              {data.map((fence) => {
                const { lat, lng } = pointToLatLng(fence.location);
                const active = fence._id === selectedId;
                return (
                  <li key={fence._id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(fence._id);
                        setCreating(false);
                      }}
                      className={cn(
                        'flex w-full items-start justify-between gap-3 border-b border-hairline px-4 py-3 text-left transition-colors last:border-b-0',
                        active ? 'bg-accent-soft' : 'hover:bg-ground',
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-ink">
                          {fence.office_name}
                        </p>
                        <p className="tnum mt-0.5 text-[10.5px] text-faint">{formatLatLng(lat, lng)}</p>
                      </div>
                      <Badge tone={active ? 'accent' : 'neutral'}>
                        <span className="tnum">{fence.radius_meters} m</span>
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </BentoTile>

      {showForm ? (
        <GeofenceForm
          key={selected?._id ?? 'new'}
          existing={selected}
          onSaved={() => {
            setCreating(false);
            setSelectedId(null);
          }}
          onCancel={() => {
            setCreating(false);
            setSelectedId(null);
          }}
        />
      ) : (
        <BentoTile rank="wide" span="bento-span-tall">
          <div className="flex flex-1 items-center justify-center p-4">
            <EmptyState
              title="Select an office to edit its geofence"
              message="Or add a new office to define where its employees may check in."
              icon={MapPin}
            />
          </div>
        </BentoTile>
      )}
    </BentoGrid>
  );
}
