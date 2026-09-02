import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(10, 'A refresh token is required.'),
});
export type RefreshInput = z.infer<typeof refreshSchema>;
