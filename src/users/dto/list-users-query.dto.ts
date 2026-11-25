import { z } from 'zod';

export const listUsersQuerySchema = z.object({
  role: z.string().trim().toLowerCase().min(1).max(48).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListUsersQueryDto = z.infer<typeof listUsersQuerySchema>;
