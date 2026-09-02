import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/states';
import { SkeletonRows } from '@/components/ui/skeleton';
import { GeofenceForm } from '@/components/forms/geofence-form';
import { RbacGate } from '@/components/common/rbac-gate';
import { fetchData } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import { formatLatLng, pointToLatLng } from '@/lib/geo';
import { cn } from '@/lib/utils';
import type { Geofence } from '@/types/models';

/** Office list on the left, editor on the right. */
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
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="h-fit">
        <CardHeader
          title="Offices"
          description={data ? `${data.length} configured` : undefined}
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
                      'flex w-full items-start justify-between gap-3 border-b border-line px-4 py-3 text-left transition-colors last:border-b-0',
                      active ? 'bg-accent-soft' : 'hover:bg-canvas',
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
      </Card>

      <div>
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
          <Card>
            <EmptyState
              title="Select an office to edit its geofence"
              message="Or add a new office to define where its employees may check in."
              icon={MapPin}
            />
          </Card>
        )}
      </div>
    </div>
  );
}
