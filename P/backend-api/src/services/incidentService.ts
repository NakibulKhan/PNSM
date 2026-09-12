import { IncidentBlocklist } from '../models';
import { logger } from '../utils/logger';

/** How long a durable block lasts once an IP escalates past the threshold. */
const BLOCK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Writes (or refreshes) one IncidentBlocklist document and logs a structured
 * warning — the honest local equivalent of dispatching to Slack/PagerDuty
 * (this project has no chat/paging integration to page out to; the structured
 * log line is the real, checkable alert artifact instead).
 */
export async function recordIncident(ip: string, reason: string, escalationCount: number): Promise<void> {
  const expires_at = new Date(Date.now() + BLOCK_TTL_MS);
  await IncidentBlocklist.findOneAndUpdate(
    { ip },
    {
      $set: { reason, expires_at, escalation_count: escalationCount },
      $setOnInsert: { first_blocked_at: new Date() },
    },
    { upsert: true, new: true },
  );
  logger.warn('incident: ip auto-blocked', { ip, reason, escalation_count: escalationCount, expires_at: expires_at.toISOString() });
}

export interface IncidentRow {
  _id: string;
  ip: string;
  reason: string;
  first_blocked_at: Date;
  escalation_count: number;
  expires_at: Date;
}

export async function listIncidents(page = 1, pageSize = 50): Promise<{ rows: IncidentRow[]; total: number; page: number; pageSize: number }> {
  const skip = (page - 1) * pageSize;
  const [rows, total] = await Promise.all([
    IncidentBlocklist.find({}).sort({ first_blocked_at: -1 }).skip(skip).limit(pageSize).lean(),
    IncidentBlocklist.countDocuments({}),
  ]);
  return {
    rows: rows.map((r) => ({
      _id: String(r._id),
      ip: r.ip,
      reason: r.reason,
      first_blocked_at: r.first_blocked_at,
      escalation_count: r.escalation_count,
      expires_at: r.expires_at,
    })),
    total,
    page,
    pageSize,
  };
}
