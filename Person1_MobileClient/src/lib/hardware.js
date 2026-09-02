import { Camera, CameraResultType, CameraSource, CameraDirection } from "@capacitor/camera";
import { Geolocation } from "@capacitor/geolocation";
import { Capacitor } from "@capacitor/core";

/**
 * Hardware telemetry bridges (Quadrant I).
 *
 * Capacitor exposes native Camera and GPS over an asynchronous IPC bridge.
 * Every call here can reject — a rejected promise from these plugins is
 * usually a permission denial or a sandbox violation, not a bug, so callers
 * must surface a recoverable message rather than crashing the WebView.
 */

/* ------------------------------------------------------------------ camera */

export async function ensureCameraPermission() {
  if (Capacitor.getPlatform() === "web") return { granted: true, canAskAgain: true };
  let status = await Camera.checkPermissions();
  if (status.camera !== "granted") {
    status = await Camera.requestPermissions({ permissions: ["camera"] });
  }
  return {
    granted: status.camera === "granted",
    // 'denied' on iOS is terminal for in-app prompting: the OS will not show
    // the dialog again, so the UI must route the user to Settings.
    canAskAgain: status.camera !== "denied",
  };
}

/**
 * Captures a front-facing selfie.
 * Returns a data URL so it can be handed straight to the canvas compressor
 * without an extra filesystem read.
 */
export async function captureSelfie() {
  const photo = await Camera.getPhoto({
    quality: 90,
    allowEditing: false,
    resultType: CameraResultType.DataUrl,
    source: CameraSource.Camera,
    direction: CameraDirection.Front,
    correctOrientation: true,
    saveToGallery: false, // biometric capture must not leak into the photo roll
  });
  return photo.dataUrl;
}

/* -------------------------------------------------------------- geolocation */

export async function ensureLocationPermission() {
  if (Capacitor.getPlatform() === "web") return { granted: true, canAskAgain: true };
  let status = await Geolocation.checkPermissions();
  if (status.location !== "granted") {
    status = await Geolocation.requestPermissions({ permissions: ["location"] });
  }
  return {
    granted: status.location === "granted",
    canAskAgain: status.location !== "denied",
  };
}

/**
 * One-shot high-accuracy fix, used at the moment of check-in.
 * enableHighAccuracy forces the GNSS chip rather than coarse network
 * positioning — necessary when a geofence radius can be as tight as 50m.
 */
export async function getCurrentPosition({ timeout = 10000 } = {}) {
  const pos = await Geolocation.getCurrentPosition({
    enableHighAccuracy: true,
    timeout,
    maximumAge: 0, // never accept a cached fix for an attendance event
  });
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    timestamp: pos.timestamp,
  };
}

/**
 * Continuous watch used to drive the live geofence badge on the check-in
 * screen. Returns the watch id; caller MUST clear it on unmount or the GNSS
 * chip stays hot and drains the battery.
 */
export async function watchPosition(onUpdate, onError) {
  return Geolocation.watchPosition(
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 },
    (pos, err) => {
      if (err) {
        onError?.(err);
        return;
      }
      if (!pos) return;
      onUpdate({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: pos.timestamp,
      });
    }
  );
}

export async function clearWatch(id) {
  if (id == null) return;
  try {
    await Geolocation.clearWatch({ id });
  } catch {
    /* watch already torn down */
  }
}
