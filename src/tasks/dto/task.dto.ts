import { z } from 'zod';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'title is required').max(150, 'title max 150 chars'),
    description: z.string().trim().max(4000, 'description max 4000 chars').optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
    dueDate: z
      .string()
      .regex(ISO_DATE_RE, 'dueDate must be YYYY-MM-DD')
      .optional(),
    assignmentType: z.enum(['self', 'individual', 'team']),
    assigneeId: z.string().uuid('assigneeId must be a valid UUID').optional(),
    teamId: z.string().uuid('teamId must be a valid UUID').optional(),
    requiresReview: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.assignmentType === 'self') {
      if (data.assigneeId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['assigneeId'],
          message: 'assigneeId must not be set for self tasks',
        });
      }
      if (data.teamId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['teamId'],
          message: 'teamId must not be set for self tasks',
        });
      }
    } else if (data.assignmentType === 'individual') {
      if (!data.assigneeId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['assigneeId'],
          message: 'assigneeId is required for individual tasks',
        });
      }
      if (data.teamId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['teamId'],
          message: 'teamId must not be set for individual tasks',
        });
      }
    } else if (data.assignmentType === 'team') {
      if (!data.teamId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['teamId'],
          message: 'teamId is required for team tasks',
        });
      }
      if (data.assigneeId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['assigneeId'],
          message: 'assigneeId must not be set for team tasks',
        });
      }
    }

    if (data.dueDate) {
      const todayIso = new Date().toISOString().slice(0, 10);
      const maxDate = new Date();
      maxDate.setUTCFullYear(maxDate.getUTCFullYear() + 2);
      const maxIso = maxDate.toISOString().slice(0, 10);

      if (data.dueDate < todayIso) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dueDate'],
          message: 'dueDate cannot be in the past',
        });
      } else if (data.dueDate > maxIso) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dueDate'],
          message: 'dueDate cannot be more than 2 years ahead',
        });
      }
    }
  });

export type CreateTaskDto = z.infer<typeof createTaskSchema>;

export const listTasksQuerySchema = z
  .object({
    status: z.enum(['active', 'cancelled']).optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    assigneeId: z.string().uuid('assigneeId must be a valid UUID').optional(),
    teamId: z.string().uuid('teamId must be a valid UUID').optional(),
    departmentId: z.string().uuid('departmentId must be a valid UUID').optional(),
    createdBy: z.string().uuid('createdBy must be a valid UUID').optional(),
    dueFrom: z.string().regex(ISO_DATE_RE, 'dueFrom must be YYYY-MM-DD').optional(),
    dueTo: z.string().regex(ISO_DATE_RE, 'dueTo must be YYYY-MM-DD').optional(),
    overdue: z.enum(['true', 'false']).optional(),
    sort: z.enum(['dueDate', 'priority', 'createdAt']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((d) => !(d.dueFrom && d.dueTo && d.dueFrom > d.dueTo), {
    message: 'dueFrom must be on or before dueTo',
    path: ['dueFrom'],
  });

export type ListTasksQueryDto = z.infer<typeof listTasksQuerySchema>;

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'title cannot be empty').max(150).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    dueDate: z.string().regex(ISO_DATE_RE, 'dueDate must be YYYY-MM-DD').nullable().optional(),
    requiresReview: z.boolean().optional(),
  })
  .strict();

export type UpdateTaskDto = z.infer<typeof updateTaskSchema>;

export const cancelTaskSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, 'Cancel reason is required')
      .max(500, 'Cancel reason must be 500 characters or fewer'),
  })
  .strict();

export type CancelTaskDto = z.infer<typeof cancelTaskSchema>;
