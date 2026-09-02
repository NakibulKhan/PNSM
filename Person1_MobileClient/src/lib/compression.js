/**
 * Client-side selfie compression (Quadrant I requirement).
 *
 * The blueprint mandates loading the captured hardware blob into an HTML5
 * <canvas> and recursively downgrading the JPEG quality matrix until the
 * binary payload is under 200KB, before any network request is issued. On a
 * degraded 3G link at a remote field site an uncompressed 4-6MB sensor photo
 * will simply time out, so this is a hard gate, not an optimisation.
 */

export const MAX_SELFIE_BYTES = 200 * 1024;
const MAX_EDGE_PX = 900; // downscale huge sensor output before quality passes
const MIN_QUALITY = 0.35;
const QUALITY_STEP = 0.12;
const MAX_PASSES = 8;

/**
 * Pure guard. Exported separately so the submit path can assert the result
 * independently of how compression got there, and so it is unit-testable
 * without a DOM/canvas.
 */
export function isUnderSizeLimit(sizeBytes, maxBytes = MAX_SELFIE_BYTES) {
  return typeof sizeBytes === "number" && sizeBytes > 0 && sizeBytes <= maxBytes;
}

/**
 * Computes target canvas dimensions preserving aspect ratio.
 * Pure — unit-testable without a DOM.
 */
export function fitDimensions(width, height, maxEdge = MAX_EDGE_PX) {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  if (width <= maxEdge && height <= maxEdge) return { width, height };
  const scale = maxEdge / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Decodes a data URL / object URL into an HTMLImageElement.
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode captured image"));
    img.src = src;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas encode failed"))),
      "image/jpeg",
      quality
    );
  });
}

/**
 * Compresses a captured selfie to under MAX_SELFIE_BYTES.
 *
 * @param {string} sourceDataUrl - data: URL from @capacitor/camera
 * @returns {Promise<{blob: Blob, sizeBytes: number, width: number, height: number,
 *                    quality: number, passes: number, underLimit: boolean}>}
 *
 * Never throws on "still too big" — it returns underLimit:false and lets the
 * caller decide. Silently shipping an oversized payload is the one thing this
 * module must not do.
 */
export async function compressSelfie(sourceDataUrl) {
  const img = await loadImage(sourceDataUrl);

  let { width, height } = fitDimensions(img.naturalWidth, img.naturalHeight);
  let quality = 0.82;
  let passes = 0;
  let blob = null;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  while (passes < MAX_PASSES) {
    passes += 1;
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    blob = await canvasToBlob(canvas, quality);
    if (blob.size <= MAX_SELFIE_BYTES) break;

    // Step quality down first (cheaper, preserves framing for face-match),
    // and only start shrinking pixel dimensions once quality bottoms out.
    if (quality > MIN_QUALITY) {
      quality = Math.max(MIN_QUALITY, quality - QUALITY_STEP);
    } else {
      width = Math.round(width * 0.82);
      height = Math.round(height * 0.82);
      if (width < 240 || height < 240) break; // below this, face-match degrades
    }
  }

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
