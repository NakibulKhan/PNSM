/**
 * Typed access to Vite's build-time environment.
 *
 * Vite exposes ONLY variables prefixed `VITE_` to client code, via
 * `import.meta.env`. There is no server runtime in this application, so every
 * value here is public by construction — it is inlined into the JavaScript
 * bundle that ships to the browser.
 *
 * CONSEQUENCE: no secret may ever live in this file or in any VITE_ variable.
 * AWS IAM keys, the Mongo connection string and the JWT signing secret belong
 * exclusively to Person 3's Express runtime and Person 4's AWS task definitions.
 * The only credential the browser ever holds is a 15-minute access token that
 * lives in memory (see `src/api/token-store.ts`).
 */

const raw = import.meta.env;

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

/** Demo mode: the Axios adapter is swapped for the in-process mock backend. */
export const IS_DEMO = bool(raw.VITE_DEMO_MODE, true);

/** Express 5 API origin, including the /api prefix. */
export const API_BASE_URL = (raw.VITE_API_BASE_URL ?? 'http://localhost:5000/api').replace(/\/+$/, '');

/** Socket.IO origin (no /api prefix — Socket.IO mounts at the server root). */
export const SOCKET_URL = raw.VITE_SOCKET_URL ?? 'http://localhost:5000';

/**
 * Mapping. The blueprint calls for a WebGL vector map. MapLibre GL JS is used
 * because it is the open fork of Mapbox GL JS with an identical API surface and
 * requires no access token, so the console degrades gracefully when a key is
 * absent. Supplying VITE_MAPBOX_TOKEN switches the style source to Mapbox.
 * See docs/02-BUG-BIBLE.md → "WebGL map fails without a token".
 */
export const MAPBOX_TOKEN = raw.VITE_MAPBOX_TOKEN ?? '';
export const MAP_TILE_URL =
  raw.VITE_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const MAP_ATTRIBUTION =
  raw.VITE_MAP_ATTRIBUTION ?? '\u00a9 OpenStreetMap contributors';

/** Build metadata, surfaced in Settings so a stale deploy is identifiable. */
export const APP_VERSION = raw.VITE_APP_VERSION ?? '2.0.0';
export const BUILD_MODE = raw.MODE;
