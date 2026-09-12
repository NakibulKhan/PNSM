import { Schema, model } from 'mongoose';
import { DEFAULT_FACE_MATCH_THRESHOLD, DEFAULT_GEOFENCE_RADIUS_METERS, DEFAULT_LATE_ARRIVAL_CUTOFF } from '../constants';

/**
 * Singleton document — always looked up/created via getSingletonPolicy()
 * below, never via a bare find() that might return the wrong one if two
 * ever existed. ADR-5: face_match_threshold defaults to 85 and is the only
 * knob for the approve/flag split; there is deliberately no separate
 * "reject" threshold (see ADR-5's rationale).
 */
const policySchema = new Schema(
  {
    /** Constant sentinel — guarantees at most one Policy document ever exists. */
    _singletonKey: { type: String, required: true, unique: true, default: 'singleton' },
    face_match_threshold: { type: Number, required: true, default: DEFAULT_FACE_MATCH_THRESHOLD, min: 0, max: 100 },
    default_radius_meters: { type: Number, required: true, default: DEFAULT_GEOFENCE_RADIUS_METERS, min: 1 },
    late_arrival_cutoff: { type: String, required: true, default: DEFAULT_LATE_ARRIVAL_CUTOFF },
    block_mock_location: { type: Boolean, required: true, default: true },
  },
  { collection: 'policy' },
);

export const Policy = model('Policy', policySchema);

const SINGLETON_KEY = 'singleton';

/**
 * Returns the one Policy document, creating it with defaults on first use.
 * Uses an atomic upsert rather than findOne-then-create: two concurrent
 * first calls racing a plain findOne+create would both see "not found" and
 * both attempt create(), and the loser would throw a duplicate-key error
 * against the unique _singletonKey index instead of just getting the
 * document the winner created.
 */
export async function getSingletonPolicy() {
  return Policy.findOneAndUpdate(
    { _singletonKey: SINGLETON_KEY },
    { $setOnInsert: { _singletonKey: SINGLETON_KEY } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}
