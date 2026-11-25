import { z } from 'zod';

export const myTasksQuerySchema = z.object({
  status: z
    .enum(['todo', 'in_progress', 'in_review', 'changes_requested', 'done', 'cancelled'])
    .optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type MyTasksQueryDto = z.infer<typeof myTasksQuerySchema>;

export const departmentBoardQuerySchema = z.object({
  departmentId: z.string().uuid('departmentId must be a valid UUID').optional(),
});

export type DepartmentBoardQueryDto = z.infer<typeof departmentBoardQuerySchema>;

export const teamBoardQuerySchema = z.object({
  teamId: z.string().uuid('teamId must be a valid UUID').optional(),
});

export type TeamBoardQueryDto = z.infer<typeof teamBoardQuerySchema>;
