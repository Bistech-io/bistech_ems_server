import { z } from 'zod';

export const forgotPasswordSchema = z
  .object({
    email: z.string().trim().email('Valid email is required').max(254),
    organizationSlug: z.string().trim().toLowerCase().optional(),
  })
  .strict();

export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;

export const verifyOtpSchema = z
  .object({
    email: z.string().trim().email('Valid email is required').max(254),
    otp: z.string().trim().regex(/^\d{6}$/, 'OTP must be exactly 6 digits'),
    organizationSlug: z.string().trim().toLowerCase().optional(),
  })
  .strict();

export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;

export const resetPasswordSchema = z
  .object({
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password cannot exceed 128 characters'),
    resetToken: z.string().trim().min(1).optional(),
  })
  .strict();

export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

