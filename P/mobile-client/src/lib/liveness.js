/**
 * Active-illumination liveness challenge (Flawless/Ultra blueprint Item 3).
 *
 * Not ISO/IEC 30107-3 certified — that requires a real accredited physical
 * lab (iBeta) and is out of scope for this project. This is a genuine,
 * own-built Presentation Attack Detection signal: the screen flashes 2
 * randomized colors while the front camera captures one frame per flash, and
 * the AI service (Person4_AIBiometricService, POST /v1/liveness/challenge)
 * checks whether the frames' color response actually correlates with the
 * reported flash — the server is the authority, never this client. See
 * CheckInScreen.jsx for where these are wired into the getUserMedia/canvas
 * capture, and checkinService.js for where the result is sent.
 */

export const LIVENESS_COLORS = ["red", "green", "blue", "white"];

/** CSS colors for the full-screen flash overlay, matching Person4's _COLOR_TARGETS. */
export const FLASH_HEX = {
  red: "#ff2828",
  green: "#28ff28",
  blue: "#2828ff",
  white: "#ffffff",
};

export const FLASH_DURATION_MS = 350;
export const CHALLENGE_FRAME_COUNT = 2;

/**
 * Picks CHALLENGE_FRAME_COUNT distinct colors, in a fresh random order every
 * call — a fixed sequence would let a pre-recorded replay attack "predict"
 * the flash. Pure and injectable so it is unit-testable without a DOM.
 *
 * @param {() => number} [rng] - defaults to Math.random; inject for deterministic tests.
 */
export function pickChallengeColors(rng = Math.random) {
  const pool = [...LIVENESS_COLORS];
  const picked = [];
  for (let i = 0; i < CHALLENGE_FRAME_COUNT && pool.length > 0; i += 1) {
    const idx = Math.floor(rng() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

/**
 * Draws the current video frame onto the given canvas and returns a small
 * base64 JPEG — deliberately tiny (this is a liveness signal, not the
 * identity selfie) so a slow connection never turns a 350ms flash into a
 * multi-second stall.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {HTMLCanvasElement} canvasEl
 * @param {{maxEdge?: number, quality?: number}} [opts]
 * @returns {string} base64-encoded JPEG bytes, no data: URL prefix.
 */
export function captureFrameBase64(videoEl, canvasEl, { maxEdge = 240, quality = 0.7 } = {}) {
  const vw = videoEl.videoWidth || maxEdge;
  const vh = videoEl.videoHeight || maxEdge;
  const scale = Math.min(1, maxEdge / Math.max(vw, vh));
  const width = Math.max(1, Math.round(vw * scale));
  const height = Math.max(1, Math.round(vh * scale));

  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, width, height);

  const dataUrl = canvasEl.toDataURL("image/jpeg", quality);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
