import { z } from 'zod';
import { safeText } from './common';

export const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const password = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(128)
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), 'Include letters and numbers');

export const registerSchema = z.object({
  name: safeText(100),
  email,
  password,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const requestPasswordResetSchema = z.object({ email });
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password,
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});
export const updateProfileSchema = z.object({ name: safeText(100) });
