/**
 * Live workforce map.
 *
 * Every office geofence is drawn as ground-accurate geometry, with one marker
 * per checked-in employee tinted by verification verdict. Markers are keyed by
 * employee id in a Map, so a socket update repositions an existing pin instead
 * of stacking a second one on top of it — the same deduplication discipline the
 * live feed uses.
 */
import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { baseStyle, gl, type GlMap, type GlMarker } from './gl';
import { circlePolygon } from '@/lib/circle';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, FACE_MATCH_THRESHOLD } from '@/lib/constants';
import { formatTime } from '@/lib/tz';
import { pointToLatLng } from '@/lib/geo';
import type { Geofence } from '@/types/models';
import type { LivePresence } from '@/types/live';

const FENCE_SOURCE = 'office-geofences';

export interface LiveMapProps {
  presence: LivePresence[];
  geofences: Geofence[];
  heightClass?: string;
}

function employeePin(verified: boolean): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="9" cy="9" r="7" fill="${verified ? '#0E7C5A' : '#B4690E'}" stroke="#ffffff" stroke-width="2.5"/>
  </svg>`;
  return element;
}

export function LiveMap({ presence, geofences, heightClass = 'h-[540px]' }: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GlMap | null>(null);
  const markersRef = useRef<Map<string, GlMarker>>(new Map());
  const readyRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const first = presence[0]
      ? pointToLatLng(presence[0].gps_location)
      : geofences[0]
        ? pointToLatLng(geofences[0].location)
        : { lat: DEFAULT_MAP_CENTER[0], lng: DEFAULT_MAP_CENTER[1] };

    const map = new gl.Map({
      container: containerRef.current,
      style: baseStyle(),
      center: [first.lng, first.lat],
      zoom: DEFAULT_MAP_ZOOM,
      attributionControl: { compact: true },
    });

    map.addControl(new gl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new gl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      map.addSource(FENCE_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: `${FENCE_SOURCE}-fill`,
        type: 'fill',
        source: FENCE_SOURCE,
        paint: { 'fill-color': '#1E5FA8', 'fill-opacity': 0.08 },
      });
      map.addLayer({
        id: `${FENCE_SOURCE}-outline`,
        type: 'line',
        source: FENCE_SOURCE,
        paint: { 'line-color': '#1E5FA8', 'line-width': 1.5 },
      });
      readyRef.current = true;
    });

    mapRef.current = map;

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- geofence polygons -------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const source = map.getSource(FENCE_SOURCE) as maplibregl.GeoJSONSource | undefined;
      source?.setData({
        type: 'FeatureCollection',
        features: geofences.map((fence) => {
          const feature = circlePolygon(fence.location.coordinates, fence.radius_meters);
          feature.properties = {
            office_name: fence.office_name ?? '',
            radius_meters: fence.radius_meters,
          };
          return feature;
        }),
      });
    };

    if (readyRef.current) apply();
    else map.once('load', apply);
  }, [geofences]);

  // ---- employee markers, reconciled by id --------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<string>();

    presence.forEach((entry) => {
      const { lat, lng } = pointToLatLng(entry.gps_location);
      const verified = entry.face_match_score >= FACE_MATCH_THRESHOLD;
      seen.add(entry.user_id);

      const existing = markersRef.current.get(entry.user_id);
      if (existing) {
        existing.setLngLat([lng, lat]);
        return;
      }

      const marker = new gl.Marker({ element: employeePin(verified) })
        .setLngLat([lng, lat])
        .setPopup(
          new gl.Popup({ offset: 14, closeButton: false }).setHTML(
            `<p style="font-size:12.5px;font-weight:600;margin:0">${entry.employee_name}</p>
             <p style="font-size:11.5px;color:#5b6a80;margin:2px 0 0">
               ${entry.employee_code}<br/>
               Checked in ${formatTime(entry.timestamp)}<br/>
               Face match ${entry.face_match_score.toFixed(1)}%
             </p>`,
          ),
        )
        .addTo(map);

      markersRef.current.set(entry.user_id, marker);
    });

    // Anyone who checked out is no longer on site: remove their pin.
    markersRef.current.forEach((marker, userId) => {
      if (!seen.has(userId)) {
        marker.remove();
        markersRef.current.delete(userId);
      }
    });
  }, [presence]);

  return (
    <div
      ref={containerRef}
      className={`${heightClass} w-full overflow-hidden rounded-sm border border-line`}
      role="application"
      aria-label="Live workforce map"
    />
  );
}
