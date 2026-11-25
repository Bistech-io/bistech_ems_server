import { z } from 'zod';

export const ROLE_SLUG_REGEX = /^[a-z0-9_]+$/;

export const roleSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Role name must be at least 2 characters')
  .max(48, 'Role name must be 48 characters or fewer')
  .regex(
    ROLE_SLUG_REGEX,
    'Role name may only contain lowercase letters, numbers, and underscores',
  );

export const scopeLevelDtoSchema = z.enum([
  'own',
  'team',
  'department',
  'managed',
  'org',
]);

export const rolePermissionInputSchema = z
  .object({
    key: z.string().trim().min(1).max(80),
    scope: scopeLevelDtoSchema.default('org'),
  })
  .strict();

export const createRoleSchema = z
  .object({
    name: roleSlugSchema,
    displayName: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(250).nullable().optional(),
    permissions: z
      .array(rolePermissionInputSchema)
      .min(1, 'Select at least one permission for the custom role'),
  })
  .strict();

export const updateRoleSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(250).nullable().optional(),
    permissions: z
      .array(rolePermissionInputSchema)
      .min(1, 'A role must retain at least one permission')
      .optional(),
  })
  .strict()
  .refine(
    (data) => data.description !== undefined || data.permissions !== undefined,
    {
      message: 'Provide description or permissions to update',
    },
  );

export type CreateRoleDto = z.infer<typeof createRoleSchema>;
export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;
