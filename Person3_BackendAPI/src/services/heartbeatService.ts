/** Background telemetry writes (DECISIONS.md B7) — "device alive and here," never an attendance event. */
import { Heartbeat } from '../models';
import type { MobileHeartbeatInput } from '../validation/mobileSchemas';

export async function recordHeartbeat(userId: string, input: MobileHeartbeatInput): Promise<void> {
  await Heartbeat.create({
    user_id: userId,
    location: { type: 'Point', coordinates: [input.lng, input.lat] },
    accuracy_meters: input.accuracy ?? null,
    timestamp: new Date(input.timestamp),
  });
}
