import { z } from 'zod';

export const updatePolicySchema = z
  .object({
    face_match_threshold: z.number().min(0).max(100),
    default_radius_meters: z.number().positive(),
    late_arrival_cutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm.'),
    block_mock_location: z.boolean(),
  })
  .partial();
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;
