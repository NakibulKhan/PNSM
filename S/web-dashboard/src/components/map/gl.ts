/**
 * Single import boundary for the WebGL mapping engine.
 *
 * WHY MAPLIBRE RATHER THAN MAPBOX GL JS
 * -------------------------------------
 * The blueprint requires a WebGL vector mapping service and names Mapbox GL JS
 * as an example. MapLibre GL JS is the open-source fork of Mapbox GL JS v1 with
 * an essentially identical API surface (`new Map()`, `Marker`, `Popup`,
 * `addSource`, `addLayer`) — but Mapbox GL JS v2+ hard-fails without a paid
 * access token, throwing "An API access token is required to use Mapbox GL JS"
 * even when pointed at a third-party style. That would make the geofence editor
 * unusable for any teammate who has not been issued a key, and would break the
 * demo if the key were rate-limited.
 *
 * MapLibre renders the same vector/raster styles with no token, so the console
 * works out of the box. Migrating to Mapbox is a three-line change confined to
 * this file: install `mapbox-gl`, swap the import below, and set
 * `mapboxgl.accessToken = MAPBOX_TOKEN`. Nothing else in the codebase imports
 * the engine directly.
 */
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_ATTRIBUTION, MAP_TILE_URL } from '@/config/env';

export const gl = maplibregl;
export type GlMap = maplibregl.Map;
export type GlMarker = maplibregl.Marker;

/**
 * A raster style built from OpenStreetMap tiles.
 *
 * Raster rather than vector because OSM's vector tiles need a key, and this
 * must work with zero credentials. The map is still WebGL-composited, so pan,
 * zoom and the geofence overlay all render on the GPU.
 *
 * Attribution is mandatory under the OSM tile usage policy, and bulk tile
 * prefetching is prohibited — so nothing here caches tiles.
 */
export function baseStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: [MAP_TILE_URL],
        tileSize: 256,
        attribution: MAP_ATTRIBUTION,
        maxzoom: 19,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#e8eef3' } },
      { id: 'osm', type: 'raster', source: 'osm' },
    ],
  };
}
