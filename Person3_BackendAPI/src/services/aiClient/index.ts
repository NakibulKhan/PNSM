import { PnsmAiClient } from './pnsmAiClient';
import { PNSM_AI_URL, PNSM_HMAC_SECRET } from '../../config/env';

let instance: PnsmAiClient | null = null;

/** Lazily-constructed singleton so a missing/placeholder secret only matters once a call is actually made. */
export function getAiClient(): PnsmAiClient {
  if (instance) return instance;
  instance = new PnsmAiClient({ baseUrl: PNSM_AI_URL, hmacSecret: PNSM_HMAC_SECRET });
  return instance;
}

export { PnsmAiClient, PnsmAiError, newUlid } from './pnsmAiClient';
export type {
  ImageRef,
  EmbedResult,
  VerifyParams,
  VerifyResult,
  DeviceInfo,
  PinHashResult,
  PinVerifyResult,
  PresignPutParams,
  PresignPutResult,
  PresignGetResult,
  DecisionBands,
} from './pnsmAiClient';
