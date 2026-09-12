/**
 * Web Worker offload for selfie compression (Item 14, Flawless/Ultra
 * blueprint). Both blueprints' WebAssembly/computational-offloading
 * sections describe the same principle: a main-thread-blocking computation
 * freezes the UI. `compression.js`'s compressSelfie() runs up to 8
 * synchronous canvas re-encode passes on every check-in — the one real,
 * already-shipping computation in this codebase that fits that description
 * (there is no PQC signature generation to offload here; that's correctly
 * deferred with DPoP). This worker runs the identical loop off the main
 * thread via OffscreenCanvas, which has no `document` to attach a canvas to.
 *
 * Message contract: {dataUrl} in, {ok, blob, sizeBytes, width, height,
 * quality, passes, underLimit} or {ok: false, error} out.
 */
import { MAX_SELFIE_BYTES, fitDimensions, isUnderSizeLimit } from "./compression";

const MIN_QUALITY = 0.35;
const QUALITY_STEP = 0.12;
const MAX_PASSES = 8;

async function compress(dataUrl) {
  const sourceBlob = await fetch(dataUrl).then((r) => r.blob());
  const bitmap = await createImageBitmap(sourceBlob);

  let { width, height } = fitDimensions(bitmap.width, bitmap.height);
  let quality = 0.82;
  let passes = 0;
  let blob = null;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");

  while (passes < MAX_PASSES) {
    passes += 1;
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    if (blob.size <= MAX_SELFIE_BYTES) break;

    if (quality > MIN_QUALITY) {
      quality = Math.max(MIN_QUALITY, quality - QUALITY_STEP);
    } else {
      width = Math.round(width * 0.82);
      height = Math.round(height * 0.82);
      if (width < 240 || height < 240) break;
    }
  }

  bitmap.close();
  return {
    blob,
    sizeBytes: blob ? blob.size : 0,
    width,
    height,
    quality,
    passes,
    underLimit: blob ? isUnderSizeLimit(blob.size) : false,
  };
}

self.onmessage = async (event) => {
  const { dataUrl } = event.data ?? {};
  try {
    const result = await compress(dataUrl);
    self.postMessage({ ok: true, ...result });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
