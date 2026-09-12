/**
 * Client-side image compression.
 *
 * A modern phone photo is 10-15 MB. Pushing that over a congested 4G link in
 * Keraniganj times out the request and leaves a half-onboarded employee. We
 * compress to under 200 KB in a web worker (so the dashboard stays responsive)
 * before a single byte crosses the network.
 *
 * Quality floor matters: Person 4's DeepFace pipeline needs enough facial
 * detail to build a usable embedding, so we cap the long edge at 1080 px and
 * hold quality at 0.8 rather than squeezing purely for size.
 */
import imageCompression from 'browser-image-compression';
import {
  COMPRESSION_INITIAL_QUALITY,
  COMPRESSION_MAX_DIMENSION,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
} from './constants';

export interface CompressionResult {
  file: File;
  originalBytes: number;
  compressedBytes: number;
  withinBudget: boolean;
}

export async function compressReferencePhoto(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<CompressionResult> {
  // EXIF gotcha: phone selfies carry an orientation tag. Reading it and passing
  // it through keeps compressed photos upright instead of rotated 90 degrees.
  let exifOrientation: number | undefined;
  try {
    exifOrientation = await imageCompression.getExifOrientation(file);
  } catch {
    exifOrientation = undefined;
  }

  const compressed = await imageCompression(file, {
    maxSizeMB: MAX_UPLOAD_MB,
    maxWidthOrHeight: COMPRESSION_MAX_DIMENSION,
    useWebWorker: true,
    initialQuality: COMPRESSION_INITIAL_QUALITY,
    fileType: 'image/jpeg',
    ...(exifOrientation !== undefined ? { exifOrientation } : {}),
    onProgress,
  });

  const normalised =
    compressed instanceof File
      ? compressed
      : new File([compressed], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });

  return {
    file: normalised,
    originalBytes: file.size,
    compressedBytes: normalised.size,
    withinBudget: normalised.size <= MAX_UPLOAD_BYTES,
  };
}
