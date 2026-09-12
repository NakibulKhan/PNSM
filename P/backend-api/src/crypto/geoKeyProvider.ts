import { GeoKeyProvider } from './fieldEnvelope';
import { PNSM_GEO_FLE_KEYS, PNSM_GEO_FLE_ACTIVE_KEY } from '../config/env';

let instance: GeoKeyProvider | null = null;

/** Lazily-constructed singleton, same pattern as aiClient/index.ts's getAiClient(). */
export function getGeoKeyProvider(): GeoKeyProvider {
  if (!instance) {
    instance = new GeoKeyProvider(PNSM_GEO_FLE_KEYS, PNSM_GEO_FLE_ACTIVE_KEY);
  }
  return instance;
}
