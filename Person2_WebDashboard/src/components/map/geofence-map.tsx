/**
 * Interactive geofence editor — the spatial wizard from the blueprint.
 *
 * The administrator drops an anchor pin on the branch epicentre and drags a
 * slider to expand a vector circle representing the permitted check-in radius,
 * from a strict 50 m indoor perimeter to a broad 500 m construction site. That
 * circle is regenerated as real ground geometry on every change, so what is on
 * screen is what MongoDB will enforce.
 *
 * MapLibre is imperative, so the map instance lives in a ref and is created once
 * in an effect. Subsequent prop changes update sources in place rather than
 * remounting — remounting a WebGL context on every slider tick would drop frames
 * and leak GPU memory.
 */
import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { baseStyle, gl, type GlMap, type GlMarker } from './gl';
import { circlePolygon } from '@/lib/circle';
import { DEFAULT_MAP_ZOOM } from '@/lib/constants';

const CIRCLE_SOURCE = 'geofence-circle';

export interface GeofenceMapProps {
  lat: number;
  lng: number;
  radiusMeters: number;
  onMove: (lat: number, lng: number) => void;
  interactive?: boolean;
  heightClass?: string;
}

export function GeofenceMap({
  lat,
  lng,
  radiusMeters,
  onMove,
  interactive = true,
  heightClass = 'h-[380px]',
}: GeofenceMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GlMap | null>(null);
  const markerRef = useRef<GlMarker | null>(null);
  const readyRef = useRef(false);

  // Keep the latest callback without re-running the map-creation effect.
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  // ---- create once -------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new gl.Map({
      container: containerRef.current,
      style: baseStyle(),
      center: [lng, lat],
      zoom: DEFAULT_MAP_ZOOM + 3,
      attributionControl: { compact: true },
      interactive,
    });

    map.addControl(new gl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new gl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      map.addSource(CIRCLE_SOURCE, {
        type: 'geojson',
        data: circlePolygon([lng, lat], radiusMeters),
      });
      map.addLayer({
        id: `${CIRCLE_SOURCE}-fill`,
        type: 'fill',
        source: CIRCLE_SOURCE,
        paint: { 'fill-color': '#1E5FA8', 'fill-opacity': 0.14 },
      });
      map.addLayer({
        id: `${CIRCLE_SOURCE}-outline`,
        type: 'line',
        source: CIRCLE_SOURCE,
        paint: { 'line-color': '#1E5FA8', 'line-width': 2 },
      });
      readyRef.current = true;
    });

    const pin = document.createElement('div');
    pin.innerHTML = `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M13 0C5.82 0 0 5.82 0 13c0 9.1 11.34 20.06 11.83 20.53a1.68 1.68 0 0 0 2.34 0C14.66 33.06 26 22.1 26 13 26 5.82 20.18 0 13 0z" fill="#1E5FA8"/>
      <circle cx="13" cy="13" r="5" fill="#ffffff"/></svg>`;
    pin.style.cursor = interactive ? 'grab' : 'default';

    const marker = new gl.Marker({ element: pin, draggable: interactive, anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(map);

    marker.on('dragend', () => {
      const position = marker.getLngLat();
      onMoveRef.current(position.lat, position.lng);
    });

    // Clicking anywhere relocates the pin — faster than dragging across a city.
    if (interactive) {
      map.on('click', (event) => {
        onMoveRef.current(event.lngLat.lat, event.lngLat.lng);
      });
    }

    mapRef.current = map;
    markerRef.current = marker;

    /*
     * Cleanup matters more here than almost anywhere else in the app. Each map
     * holds a WebGL context, and browsers cap the number of live contexts
     * (~16 in Chrome). React StrictMode mounts this twice in development, so
     * without remove() the editor would exhaust contexts after a few visits and
     * silently render blank.
     */
    return () => {
      marker.remove();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      readyRef.current = false;
    };
    // Intentionally created once; position and radius are synced by the effects
    // below. Re-creating the map on every prop change would destroy the WebGL
    // context 60 times a second while the radius slider is dragged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive]);

  // ---- sync pin + viewport ----------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    marker.setLngLat([lng, lat]);
    map.easeTo({ center: [lng, lat], duration: 320 });
  }, [lat, lng]);

  // ---- sync the radius geometry -----------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const source = map.getSource(CIRCLE_SOURCE) as maplibregl.GeoJSONSource | undefined;
      source?.setData(circlePolygon([lng, lat], radiusMeters));
    };

    if (readyRef.current) apply();
    else map.once('load', apply);
  }, [lat, lng, radiusMeters]);

  return (
    <div
      ref={containerRef}
      className={`${heightClass} w-full overflow-hidden rounded-sm border border-line`}
      role="application"
      aria-label="Geofence location editor"
    />
  );
}
