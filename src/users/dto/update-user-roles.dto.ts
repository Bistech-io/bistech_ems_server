import { z } from 'zod';

export const updateUserRolesSchema = z
  .object({
    roles: z
      .array(
        z.enum([
          'super_admin',
          'hr_manager',
          'dept_head',
          'department_head',
          'employee',
        ]),
      )
      .min(1, 'At least one role is required')
      .max(5),
    departmentId: z.string().uuid('departmentId must be a valid UUID').optional(),
  })
  .strict();

export type UpdateUserRolesDto = z.infer<typeof updateUserRolesSchema>;
