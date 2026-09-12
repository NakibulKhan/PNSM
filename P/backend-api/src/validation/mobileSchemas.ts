import { z } from 'zod';

/** DECISIONS.md N3 — mobile login is password-only, keyed on employee_code. */
export const mobileLoginSchema = z.object({
  employee_code: z.string().trim().min(1, 'Employee ID is required.'),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
});
export type MobileLoginInput = z.infer<typeof mobileLoginSchema>;

export const mobileRefreshSchema = z.object({
  refresh_token: z.string().min(10).optional(),
});
export type MobileRefreshInput = z.infer<typeof mobileRefreshSchema>;

const deviceSchema = z.object({
  platform: z.enum(['android', 'ios', 'web']),
  os_version: z.string().default(''),
  app_version: z.string().default(''),
  is_mock_location: z.boolean(),
  is_emulator: z.boolean(),
  is_rooted: z.boolean(),
});

const gpsSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/**
 * Item 3 (Flawless/Ultra blueprint): active-illumination liveness challenge
 * frames — 2-4 captures, one per screen-flash color the client displayed.
 * Not ISO/IEC 30107-3 certified; a real, own-built PAD signal verified
 * server-side by Person 4's AI service (POST /v1/liveness/challenge), never
 * trusted from a client-supplied pass/fail boolean.
 */
const livenessFrameSchema = z.object({
  color: z.enum(['red', 'green', 'blue', 'white']),
  image: z.object({
    kind: z.literal('base64'),
    value: z.string().min(1),
  }),
});

/**
 * DECISIONS.md N2/N5 — no selfie bytes here, only the object_key from an
 * already-completed presigned upload. `request_id` is optional because
 * Person 1's client does not generate one yet (DECISIONS.md N5 follow-up);
 * the route falls back to a server-generated ULID when absent.
 */
export const mobileCheckinSchema = z.object({
  check_type: z.enum(['check_in', 'check_out']),
  timestamp: z.string().datetime({ offset: true }),
  captured_at: z.string().datetime({ offset: true }),
  gps: gpsSchema,
  geofence_id: z.string().min(1, 'geofence_id is required.'),
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits.'),
  // Deliberately NOT `.min(2)`: an empty/short array is a legitimate
  // real-world submission (camera permission denied, getUserMedia
  // unavailable on the WebView) that the client forwards as captured rather
  // than pre-empting locally (see __tests__/checkinFlow.test.js's own
  // "rather than deciding pass/fail locally" test on the mobile side). A
  // generic 422 here would be indistinguishable from a malformed request;
  // attendanceService.ts's performCheckin() checks the count explicitly and
  // fails closed with the specific `liveness_failed` business reason
  // instead, matching how every other liveness/PAD rejection surfaces.
  liveness_frames: z.array(livenessFrameSchema).max(4),
  object_key: z.string().min(1, 'object_key is required — upload the selfie first.'),
  device: deviceSchema,
  request_id: z.string().min(10).optional(),
});
export type MobileCheckinInput = z.infer<typeof mobileCheckinSchema>;

export const mobileAnomalySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  platform: z.string().optional(),
  indicated_apps: z.array(z.string()).optional(),
  detection_confidence: z.number().optional(),
  timestamp: z.string().datetime({ offset: true }),
});
export type MobileAnomalyInput = z.infer<typeof mobileAnomalySchema>;

export const mobileHeartbeatSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().optional(),
  timestamp: z.string().datetime({ offset: true }),
});
export type MobileHeartbeatInput = z.infer<typeof mobileHeartbeatSchema>;

export const mobilePresignSchema = z.object({
  purpose: z.enum(['checkin', 'reference']),
  content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  content_length: z.number().int().positive(),
});
export type MobilePresignInput = z.infer<typeof mobilePresignSchema>;
