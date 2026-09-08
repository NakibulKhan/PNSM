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
 *
 * Renders as several Bento tiles, not one card — the `<form>` itself uses
 * `className="contents"` so it drops out of layout and its tile children
 * become direct grid items of the caller's `BentoGrid` (`geofence-manager.tsx`),
 * matching the master prompt's own §6.5 wireframe (hero map + anchor/radius
 * squares + a save rail) while keeping the real form's full field set — office
 * name/address have no place in that minimal wireframe, so they get their own
 * tile rather than being dropped.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPinCheck, Save, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { GeofenceMap } from '@/components/map/geofence-map';
import { BentoTile } from '@/components/bento/BentoTile';
import { TileHeader } from '@/components/bento/TileHeader';
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
  // Hydrated from the record, not blank. Leaving this empty meant every edit
  // PATCHed `address: ''` and silently erased the office's stored address —
  // the backend now returns `address` on the geofence DTO so this can round-trip.
  const [address, setAddress] = useState(existing?.address ?? '');
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
    setAddress(existing.address ?? '');
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
    <form onSubmit={submit} className="contents">
      <BentoTile rank="wide" span="bento-span-tall">
        <TileHeader
          title={existing ? `Edit ${existing.office_name}` : 'Add an office geofence'}
          support="Drop the pin on the building, then set how far from it a check-in is accepted."
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-2">
          {/* Fixed height chosen to fit this tile's clamped max-height (bento.css)
              alongside the header above it — GeofenceMap's own WebGL lifecycle
              (map/marker creation, cleanup) is untouched, only the container's
              CSS height, which the component already exposes for exactly this. */}
          <GeofenceMap lat={lat} lng={lng} radiusMeters={radius} onMove={movePin} heightClass="h-[300px]" />
          <p className="mt-1.5 text-[11px] text-faint">
            Click the map or drag the pin to reposition. Moving the pin clears the confirmation.
          </p>
        </div>
      </BentoTile>

      <BentoTile rank="square">
        <TileHeader title="Office details" />
        <div className="flex flex-1 flex-col gap-3 p-4 pt-2">
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
        </div>
      </BentoTile>

      <BentoTile rank="square">
        <TileHeader title="Anchor" />
        <div className="flex flex-1 flex-col gap-2 p-4 pt-2">
          <p className="tnum text-[13px] text-ink">{formatLatLng(lat, lng)}</p>
          <p className="tnum text-[10.5px] text-faint">
            Stored as GeoJSON [{lng.toFixed(6)}, {lat.toFixed(6)}]
          </p>
          {outsideBangladesh ? (
            <p className="mt-1 flex items-start gap-1.5 rounded-sm border border-flagged/30 bg-flagged-soft px-2.5 py-2 text-[11.5px] text-flagged">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
              This pin is outside Bangladesh. If that is unexpected, the coordinates may be
              reversed.
            </p>
          ) : null}
        </div>
      </BentoTile>

      <BentoTile rank="square">
        <TileHeader title="Check-in radius" action={<span className="tnum text-ink">{radius} m</span>} />
        <div className="flex flex-1 flex-col p-4 pt-2">
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
                    : 'border-line-strong bg-surface text-muted hover:bg-ground',
                )}
              >
                {preset.label} <span className="tnum">{preset.meters} m</span>
              </button>
            ))}
          </div>
        </div>
      </BentoTile>

      <BentoTile rank="rail">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <label className="flex cursor-pointer items-start gap-2">
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
        </div>
      </BentoTile>
    </form>
  );
}
