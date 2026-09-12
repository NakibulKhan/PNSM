import { Schema, model } from 'mongoose';

/**
 * Local, no-AWS analog of GuardDuty/EventBridge/Lambda auto-remediation
 * (Flawless/Ultra blueprint Item 3c). An IP that trips an escalated rate-limit
 * block a second time (src/middleware/rateLimiter.ts's `onBlocked` hook, via
 * escalateToIncident in src/middleware/incidentBlocklist.ts) gets one document
 * here; src/middleware/incidentBlocklist.ts's perimeter check rejects every
 * subsequent request from a still-active entry before it reaches any route.
 */
const incidentBlocklistSchema = new Schema(
  {
    ip: { type: String, required: true },
    reason: { type: String, required: true },
    first_blocked_at: { type: Date, required: true, default: () => new Date() },
    escalation_count: { type: Number, required: true, default: 1 },
    expires_at: { type: Date, required: true },
  },
  { collection: 'incident_blocklist' },
);

// One active entry per IP; TTL index auto-expires the document itself once
// `expires_at` passes, so a lifted block never needs a manual cleanup job.
incidentBlocklistSchema.index({ ip: 1 }, { unique: true });
incidentBlocklistSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const IncidentBlocklist = model('IncidentBlocklist', incidentBlocklistSchema);
