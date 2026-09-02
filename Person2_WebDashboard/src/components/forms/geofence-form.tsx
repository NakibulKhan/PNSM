/**
 * Office and geofence editor (FR-02).
 *
 * Two things are load-bearing here:
 *
 * 1. COORDINATE ORDER. The map reports a position as named `{ lat, lng }`, and
 *    MongoDB needs GeoJSON [lng, lat]. The conversion happens exactly once, in
 *    the mutation, through `toGeoJSONTuple`, and the payload is validated by
 *    `geoJSONPointSchema` before it is sent. Nothing else in this file touches
 *    a raw tuple. The write itself sends flat `lat`/`lng` fields, which cannot
 *    be mis-ordered in transit.
 *
 * 2. VERIFICATION GATE. FR-02 requires the office location to be confirmed on a
 *    map before the geofence is saved, so the submit button stays disabled until
 *    the pin has been placed and explicitly confirmed.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPinCheck, Save, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { GeofenceMap } from '@/components/map/geofence-map';
import { useToast } from '@/components/ui/toast';
import { api } from '@/api/client';
import { queryKeys } from '@/lib/query-keys';
import {
  DEFAULT_GEOFENCE_RADIUS,
  DEFAULT_MAP_CENTER,
  MAX_GEOFENCE_RADIUS,
  MIN_GEOFENCE_RADIUS,
  RADIUS_PRESETS,
} from '@/lib/constants';
import {
  formatLatLng,
  geoJSONPointSchema,
  isWithinBangladesh,
  pointToLatLng,
  toGeoJSONTuple,
} from '@/lib/geo';
import { cn } from '@/lib/utils';
import type { Geofence } from '@/types/models';

export function GeofenceForm({
  existing,
  onSaved,
  onCancel,
}: {
  existing?: Geofence | null;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const initial = existing ? pointToLatLng(existing.location) : null;

  const [officeName, setOfficeName] = useState(existing?.office_name ?? '');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState(initial?.lat ?? DEFAULT_MAP_CENTER[0]);
  const [lng, setLng] = useState(initial?.lng ?? DEFAULT_MAP_CENTER[1]);
  const [radius, setRadius] = useState(existing?.radius_meters ?? DEFAULT_GEOFENCE_RADIUS);
  const [verified, setVerified] = useState(Boolean(existing));
  const [formError, setFormError] = useState<string | null>(null);

  // Moving the pin invalidates a previous confirmation — the point of the gate.
  const movePin = (nextLat: number, nextLng: number) => {
    setLat(nextLat);
    setLng(nextLng);
    setVerified(false);
  };

  useEffect(() => {
    if (!existing) return;
    const point = pointToLatLng(existing.location);
    setLat(point.lat);
    setLng(point.lng);
    setRadius(existing.radius_meters);
    setOfficeName(existing.office_name ?? '');
    setVerified(true);
  }, [existing]);

  const outsideBangladesh = !isWithinBangladesh(lat, lng);

  const save = useMutation({
    mutationFn: async () => {
      // The single crossing from named lat/lng into GeoJSON order.
      const coordinates = toGeoJSONTuple(lat, lng);

      // Guard the payload before it can reach the database. A reversed tuple is
      // rejected here rather than silently stored.
      const validated = geoJSONPointSchema.safeParse({ type: 'Point', coordinates });
      if (!validated.success) {
        throw new Error(validated.error.issues[0]?.message ?? 'The coordinates are not valid.');
      }

      const payload = {
        office_name: officeName.trim(),
        address: address.trim(),
        lat,
        lng,
        radius_meters: radius,
      };

      if (existing) {
        const { data } = await api.patch<Geofence>(`geofences/${existing._id}`, payload);
        return data;
      }
      const { data } = await api.post<Geofence>('geofences', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.geofences });
      queryClient.invalidateQueries({ queryKey: queryKeys.offices });
      toast({
        tone: 'success',
        title: existing ? 'Geofence updated' : 'Geofence saved',
        description: `${officeName} now validates check-ins within ${radius} m.`,
      });
      onSaved?.();
    },
    onError: (error: Error) => {
      setFormError(error.message);
      toast({ tone: 'error', title: 'Geofence not saved', description: error.message });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!existing) return;
      await api.delete(`geofences/${existing._id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.geofences });
      toast({ tone: 'success', title: 'Geofence removed' });
      onSaved?.();
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!officeName.trim()) {
      setFormError('Enter the office name.');
      return;
    }
    if (!verified) {
      setFormError('Confirm the office pin on the map before saving.');
      return;
    }
    save.mutate();
  };

  return (
    <form onSubmit={submit}>
      <Card>
        <CardHeader
          title={existing ? `Edit ${existing.office_name}` : 'Add an office geofence'}
          description="Drop the pin on the building, then set how far from it a check-in is accepted."
        />

        <CardBody className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div>
            <GeofenceMap lat={lat} lng={lng} radiusMeters={radius} onMove={movePin} />
            <p className="mt-1.5 text-[11px] text-faint">
              Click the map or drag the pin to reposition. Moving the pin clears the confirmation.
            </p>
          </div>

          <div className="space-y-4">
            <Field label="Office name" required>
              <Input
                value={officeName}
                onChange={(event) => setOfficeName(event.target.value)}
                placeholder="Gulshan Office"
              />
            </Field>

            <Field label="Address" hint="Shown in reports and on the live map">
              <Input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Plot 12, Road 103, Gulshan-2"
              />
            </Field>

            <div>
              <span className="eyebrow mb-1.5 block">
                Check-in radius <span className="tnum text-ink">{radius} m</span>
              </span>
              <Slider
                value={radius}
                min={MIN_GEOFENCE_RADIUS}
                max={MAX_GEOFENCE_RADIUS}
                step={5}
                onValueChange={setRadius}
                aria-label="Check-in radius in metres"
              />
              <div className="tnum mt-1 flex justify-between text-[10.5px] text-faint">
                <span>{MIN_GEOFENCE_RADIUS} m</span>
                <span>{MAX_GEOFENCE_RADIUS} m</span>
              </div>

              {/*
                Presets, not decoration. A 50 m perimeter suits an indoor office
                where GPS drift is the main risk; a construction site needs 500 m
                or genuine arrivals get rejected. Naming the situation is more
                useful to an HR user than asking them to guess a number.
              */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {RADIUS_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setRadius(preset.meters)}
                    aria-pressed={radius === preset.meters}
                    className={cn(
                      'rounded-xs border px-2 py-1 text-[11px] font-medium transition-colors',
                      radius === preset.meters
                        ? 'border-accent bg-accent-soft text-accent-dark'
                        : 'border-line-strong bg-surface text-muted hover:bg-canvas',
                    )}
                  >
                    {preset.label} <span className="tnum">{preset.meters} m</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-sm border border-line bg-canvas p-3">
              <p className="eyebrow mb-1">Centre coordinates</p>
              <p className="tnum text-[12px] text-ink">{formatLatLng(lat, lng)}</p>
              <p className="tnum mt-1 text-[10.5px] text-faint">
                Stored as GeoJSON [{lng.toFixed(6)}, {lat.toFixed(6)}]
              </p>
            </div>

            {outsideBangladesh ? (
              <p className="flex items-start gap-1.5 rounded-sm border border-flagged/30 bg-flagged-soft px-2.5 py-2 text-[11.5px] text-flagged">
                <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
                This pin is outside Bangladesh. If that is unexpected, the coordinates may be
                reversed.
              </p>
            ) : null}

            <label className="flex cursor-pointer items-start gap-2 rounded-sm border border-line bg-surface p-3">
              <input
                type="checkbox"
                checked={verified}
                onChange={(event) => setVerified(event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-accent)]"
              />
              <span className="text-[11.5px] text-muted">
                <span className="font-semibold text-ink">I have checked the pin</span> — it sits on the
                correct building on the map.
              </span>
            </label>
          </div>
        </CardBody>

        <CardFooter className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {formError ? (
              <p className="text-[11.5px] font-medium text-rejected">{formError}</p>
            ) : (
              <p className="flex items-center gap-1.5 text-[11.5px] text-faint">
                <MapPinCheck size={13} aria-hidden />
                Employees at this office are validated against the new geofence on their next check-in.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {existing ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={remove.isPending}
                onClick={() => remove.mutate()}
              >
                <Trash2 size={13} aria-hidden /> Remove
              </Button>
            ) : null}
            {onCancel ? (
              <Button type="button" variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
            <Button type="submit" loading={save.isPending} disabled={!verified}>
              <Save size={14} aria-hidden />
              {existing ? 'Save changes' : 'Save geofence'}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </form>
  );
}
