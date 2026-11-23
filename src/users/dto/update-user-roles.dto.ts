import { z } from 'zod';

export const updateUserRolesSchema = z
  .object({
    roles: z
      .array(z.enum(['super_admin', 'hr_manager', 'department_head', 'employee']))
      .min(1, 'At least one role is required')
      .max(4),
  })
  .strict();

export type UpdateUserRolesDto = z.infer<typeof updateUserRolesSchema>;
