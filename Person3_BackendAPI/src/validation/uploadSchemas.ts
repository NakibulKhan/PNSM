import { z } from 'zod';

/**
 * Matches Person 2's documented POST /uploads/presign body
 * (01-API-CONTRACT.md) for the admin console's reference-photo uploads.
 * Proxies to Person 4's presign-put under the hood (DECISIONS.md N2).
 */
export const adminPresignSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  purpose: z.literal('reference_photo'),
});
export type AdminPresignInput = z.infer<typeof adminPresignSchema>;
