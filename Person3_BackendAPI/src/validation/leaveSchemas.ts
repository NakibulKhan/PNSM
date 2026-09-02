import { z } from 'zod';
import { LEAVE_STATUSES, LEAVE_TYPES } from '../constants';

export const listLeaveQuerySchema = z.object({
  status: z.enum(LEAVE_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListLeaveQuery = z.infer<typeof listLeaveQuerySchema>;

export const createLeaveRequestSchema = z.object({
  leave_type: z.enum(LEAVE_TYPES),
  from_date: z.string().datetime({ offset: true }),
  to_date: z.string().datetime({ offset: true }),
  reason: z.string().trim().default(''),
});
export type CreateLeaveRequestInput = z.infer<typeof createLeaveRequestSchema>;
