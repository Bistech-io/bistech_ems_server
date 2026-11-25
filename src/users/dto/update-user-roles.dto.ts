import { z } from 'zod';
import { roleSlugSchema } from './role.dto.js';

export const updateUserRolesSchema = z
  .object({
    roles: z
      .array(roleSlugSchema)
      .min(1, 'At least one role is required')
      .max(10),
    departmentId: z.string().uuid('departmentId must be a valid UUID').optional(),
  })
  .strict();

export type UpdateUserRolesDto = z.infer<typeof updateUserRolesSchema>;
