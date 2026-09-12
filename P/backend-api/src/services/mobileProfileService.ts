/**
 * GET /api/mobile/me (DECISIONS.md N4) — drives HomeScreen/ProfileScreen and
 * supplies a real Mongo geofence_id for check-in, replacing the hardcoded
 * OFFICES slugs in Person 1's current AppContext.jsx.
 */
import { AttendanceLog, Geofence, Office, Shift, User } from '../models';
import { geofenceToNamedPoint } from './officeGeofenceService';
import { MobileApiError } from '../utils/errors';

export async function getMobileProfile(userId: string) {
  const user = await User.findById(userId).lean();
  if (!user || !user.is_active) {
    throw new MobileApiError(401, 'unauthenticated');
  }

  const [office, shift, recentLogs] = await Promise.all([
    user.office_id ? Office.findById(user.office_id).lean() : null,
    Shift.findOne({ user_id: userId }).lean(),
    AttendanceLog.find({ user_id: userId }).sort({ timestamp: -1 }).limit(10).lean(),
  ]);

  const geofence = office ? await Geofence.findOne({ office_id: office._id }).lean() : null;

  return {
    employee: {
      _id: String(user._id),
      name: user.name,
      employee_code: user.employee_code ?? null,
      email: user.email,
      department: user.department ?? '',
      reference_photo_url: user.reference_photo_url,
    },
    office: office ? { _id: String(office._id), office_name: office.office_name, address: office.address } : null,
    geofence: geofence
      ? { _id: String(geofence._id), radius_meters: geofence.radius_meters, ...geofenceToNamedPoint(geofence) }
      : null,
    shift: shift
      ? {
          start_time: shift.start_time,
          end_time: shift.end_time,
          days_of_week: shift.days_of_week,
          days_of_week_label: shift.days_of_week_label,
        }
      : null,
    recent_logs: recentLogs.map((log) => ({
      _id: String(log._id),
      check_type: log.check_type,
      timestamp: log.timestamp,
      status: log.status,
      face_match_score: log.face_match_score,
    })),
  };
}
