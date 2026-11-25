import { z } from 'zod';

export const createTeamSchema = z
  .object({
    departmentId: z.string().uuid('departmentId must be a valid UUID'),
    name: z
      .string()
      .trim()
      .min(2, 'Team name must be at least 2 characters')
      .max(80, 'Team name must be 80 characters or fewer'),
    description: z.string().trim().max(500).optional(),
    memberIds: z
      .array(z.string().uuid('Each memberId must be a valid UUID'))
      .max(50, 'At most 50 members per team')
      .default([]),
  })
  .strict();

export type CreateTeamDto = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Team name must be at least 2 characters')
      .max(80, 'Team name must be 80 characters or fewer')
      .optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export type UpdateTeamDto = z.infer<typeof updateTeamSchema>;

export const addTeamMembersSchema = z
  .object({
    employeeIds: z
      .array(z.string().uuid('Each employeeId must be a valid UUID'))
      .min(1, 'At least one employeeId is required')
      .max(50, 'At most 50 members can be added at once'),
  })
  .strict();

export type AddTeamMembersDto = z.infer<typeof addTeamMembersSchema>;

export const listTeamsQuerySchema = z.object({
  departmentId: z.string().uuid('departmentId must be a valid UUID').optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListTeamsQueryDto = z.infer<typeof listTeamsQuerySchema>;
