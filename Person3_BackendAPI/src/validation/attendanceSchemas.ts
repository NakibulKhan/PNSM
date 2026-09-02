import { z } from 'zod';
import { ATTENDANCE_STATUSES } from '../constants';

export const listAttendanceQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  officeId: z.string().min(1).optional(),
  employeeId: z.string().min(1).optional(),
  status: z.enum(ATTENDANCE_STATUSES).optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListAttendanceQuery = z.infer<typeof listAttendanceQuerySchema>;

export const attendanceFeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(15),
});
export type AttendanceFeedQuery = z.infer<typeof attendanceFeedQuerySchema>;

export const dashboardTrendQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});
export type DashboardTrendQuery = z.infer<typeof dashboardTrendQuerySchema>;
