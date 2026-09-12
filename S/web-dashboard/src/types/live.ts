import type { AttendanceLog } from './models';

/**
 * GET /attendance/live-map — who is currently on site.
 *
 * L4 (master audit): this used to be a hand-copied subset of the real fields
 * (missing `_id`, `status`, and others) that had already drifted from the
 * actual wire shape. Person 3's `getLiveMap()` maps through the exact same
 * `toAttendanceRowDTO()` every other attendance-row endpoint uses, so this is
 * just `AttendanceLog` — a type alias can't drift the way a hand-copied
 * interface did.
 */
export type LivePresence = AttendanceLog;
