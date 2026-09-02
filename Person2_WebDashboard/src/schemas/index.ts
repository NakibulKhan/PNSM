/**
 * Form validation schemas. These are the single source of truth for what the
 * admin UI will accept; the resulting types are inferred, never hand-written.
 */
import { z } from 'zod';
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_GEOFENCE_RADIUS,
  MIN_GEOFENCE_RADIUS,
} from '@/lib/constants';
import { latitudeSchema, longitudeSchema } from '@/lib/geo';

// ---------------------------------------------------------------- auth ------
export const loginSchema = z.object({
  email: z.string().min(1, 'Enter your work email').email('Enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ----------------------------------------------------------- employee ------
export const employeeSchema = z.object({
  name: z
    .string()
    .min(2, 'Enter the full name')
    .max(80, 'Name is too long'),
  employee_code: z
    .string()
    .min(2, 'Enter the employee ID')
    .max(24, 'Employee ID is too long')
    .regex(/^[A-Za-z0-9-_]+$/, 'Use letters, numbers, hyphens and underscores only'),
  email: z.string().min(1, 'Enter a work email').email('Enter a valid email address'),
  phone: z
    .string()
    .min(11, 'Enter an 11-digit mobile number')
    .regex(/^01[3-9]\d{8}$/, 'Enter a valid Bangladeshi mobile number, e.g. 01712345678'),
  department: z.string().min(2, 'Enter the department'),
  shift_start: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM'),
  shift_end: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM'),
  days_of_week: z.string().min(3, 'Enter the working days'),
  office_id: z.string().min(1, 'Assign an office'),
  reference_photo_url: z.string().min(1, 'Upload a reference photo'),
});
export type EmployeeInput = z.infer<typeof employeeSchema>;

/** The wizard validates step 1 before letting the user reach the photo step. */
export const employeeDetailsStepSchema = employeeSchema.omit({ reference_photo_url: true });
export type EmployeeDetailsStepInput = z.infer<typeof employeeDetailsStepSchema>;

// ----------------------------------------------------------- geofence ------
export const geofenceSchema = z
  .object({
    office_name: z.string().min(2, 'Enter the office name'),
    address: z.string().min(4, 'Enter the address'),
    lat: latitudeSchema,
    lng: longitudeSchema,
    radius_meters: z
      .number()
      .int('Radius must be a whole number of metres')
      .min(MIN_GEOFENCE_RADIUS, `Radius must be at least ${MIN_GEOFENCE_RADIUS} m`)
      .max(MAX_GEOFENCE_RADIUS, `Radius must be ${MAX_GEOFENCE_RADIUS} m or less`),
    /** Set true once the pin has been confirmed on the map (FR-02 precondition). */
    location_verified: z.literal(true, {
      errorMap: () => ({ message: 'Confirm the office pin on the map before saving' }),
    }),
  })
  .refine((value) => !(value.lat === 0 && value.lng === 0), {
    message: 'Drop a pin on the map to set the office location',
    path: ['lat'],
  });
export type GeofenceInput = z.infer<typeof geofenceSchema>;

// -------------------------------------------------------------- leave ------
export const leaveDecisionSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(240).optional(),
});
export type LeaveDecisionInput = z.infer<typeof leaveDecisionSchema>;

// ------------------------------------------------------------- review ------
export const reviewDecisionSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().max(240).optional(),
});
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;

// ------------------------------------------------------------ filters ------
export const attendanceFilterSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  officeId: z.string().optional(),
  status: z.enum(['all', 'approved', 'flagged', 'rejected']).default('all'),
  search: z.string().optional(),
});
export type AttendanceFilterInput = z.infer<typeof attendanceFilterSchema>;

// ------------------------------------------------------------- policy ------
export const policySchema = z.object({
  face_match_threshold: z.number().min(50).max(99),
  default_radius_meters: z.number().int().min(MIN_GEOFENCE_RADIUS).max(MAX_GEOFENCE_RADIUS),
  late_arrival_cutoff: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM'),
  block_mock_location: z.boolean(),
});
export type PolicyInput = z.infer<typeof policySchema>;

// -------------------------------------------------------------- files ------
/** Client-side file guard. Runs before compression so bad files fail fast. */
export function validateImageFile(file: File): { ok: true } | { ok: false; message: string } {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    return { ok: false, message: 'Reference photos must be JPEG or PNG.' };
  }
  if (file.size > 25 * 1024 * 1024) {
    return { ok: false, message: 'That file is over 25 MB. Choose a smaller photo.' };
  }
  return { ok: true };
}
