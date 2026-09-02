import { AttendanceLog, LeaveRequest, User } from '../models';
import { getSingletonPolicy } from '../models/Policy';
import { dhakaDayStartUtc, isLateArrival, lastNDhakaDateKeys, todayDhakaKey, todayDhakaRangeUtc } from '../utils/tz';

/**
 * `checkedInToday` counts DISTINCT employees for the Asia/Dhaka day (starts
 * 18:00Z the previous day) — a naive UTC-midnight boundary silently drops
 * every evening shift (01-API-CONTRACT.md's explicit warning).
 */
export async function getDashboardKpis() {
  const { from, to } = todayDhakaRangeUtc();
  const policy = await getSingletonPolicy();

  const [checkedInToday, flaggedToday, todaysLogs, onLeave, totalEmployees] = await Promise.all([
    AttendanceLog.distinct('user_id', { timestamp: { $gte: from, $lte: to }, check_type: 'check_in' }).then(
      (ids) => ids.length,
    ),
    AttendanceLog.countDocuments({ timestamp: { $gte: from, $lte: to }, status: 'flagged' }),
    AttendanceLog.find({ timestamp: { $gte: from, $lte: to }, check_type: 'check_in' })
      .select('timestamp face_match_score')
      .lean(),
    LeaveRequest.countDocuments({
      status: 'approved',
      from_date: { $lte: to },
      to_date: { $gte: from },
    }),
    User.countDocuments({ is_active: true }),
  ]);

  const lateArrivals = todaysLogs.filter((log) => isLateArrival(log.timestamp, policy.late_arrival_cutoff)).length;
  const avgFaceMatch = todaysLogs.length
    ? Math.round(todaysLogs.reduce((sum, log) => sum + (log.face_match_score ?? 0), 0) / todaysLogs.length)
    : 0;

  return { checkedInToday, onLeave, lateArrivals, avgFaceMatch, totalEmployees, flaggedToday };
}

/** [{ date, count, label }] for the last N Dhaka calendar days, oldest first. */
export async function getDashboardTrend(days: number) {
  const keys = lastNDhakaDateKeys(days);
  const rangeStart = dhakaDayStartUtc(keys[0]);

  const rows = await AttendanceLog.aggregate<{ _id: string; count: number }>([
    { $match: { timestamp: { $gte: rangeStart }, check_type: 'check_in' } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp', timezone: 'Asia/Dhaka' } },
        count: { $sum: 1 },
      },
    },
  ]);
  const countByDate = new Map(rows.map((r) => [r._id, r.count]));

  return keys.map((date) => ({
    date,
    count: countByDate.get(date) ?? 0,
    label: `${date.slice(8, 10)}/${date.slice(5, 7)}`,
  }));
}

/** Exposed for tests / debugging parity with the "today" boundary the KPIs use. */
export function currentDhakaDateKey(): string {
  return todayDhakaKey();
}
