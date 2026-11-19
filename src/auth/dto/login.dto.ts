import { z } from 'zod';

export const loginSchema = z
  .object({
    username: z.string().trim().min(1, 'Username is required').toLowerCase(),
    password: z.string().min(1, 'Password is required'),
    organizationSlug: z.string().trim().min(1).optional(),
  })
  .strict();

export type LoginDto = z.infer<typeof loginSchema>;
