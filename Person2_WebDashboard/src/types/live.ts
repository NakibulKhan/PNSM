import type { GeoJSONPoint, ObjectId } from './models';

/** GET /attendance/live-map — who is currently on site. */
export interface LivePresence {
  user_id: ObjectId;
  employee_name: string;
  employee_code: string;
  office_name: string;
  timestamp: string;
  face_match_score: number;
  /** `null` on a decrypt failure — see AttendanceLog.gps_location's doc comment in models.ts. */
  gps_location: GeoJSONPoint | null;
}
