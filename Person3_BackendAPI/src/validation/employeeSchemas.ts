import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm.');

/**
 * Matches Person 2's documented POST /employees body exactly
 * (01-API-CONTRACT.md). `days_of_week` arrives as a display label
 * ("Sun-Thu") — see utils/shiftDays.ts's parseWeekLabel (DECISIONS.md N6).
 */
export const createEmployeeSchema = z.object({
  name: z.string().trim().min(1),
  employee_code: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().default(''),
  department: z.string().trim().default(''),
  shift_start: hhmm,
  shift_end: hhmm,
  days_of_week: z.string().trim().min(1),
  office_id: z.string().min(1),
  reference_photo_url: z.string().url(),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z
  .object({
    name: z.string().trim().min(1),
    phone: z.string().trim(),
    department: z.string().trim(),
    office_id: z.string().min(1),
    is_active: z.boolean(),
    shift_start: hhmm,
    shift_end: hhmm,
    days_of_week: z.string().trim().min(1),
  })
  .partial();
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const updateEmployeePhotoSchema = z.object({
  reference_photo_url: z.string().url(),
});
export type UpdateEmployeePhotoInput = z.infer<typeof updateEmployeePhotoSchema>;

export const listEmployeesQuerySchema = z.object({
  search: z.string().trim().optional(),
  officeId: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;
