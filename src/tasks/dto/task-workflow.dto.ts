import { z } from 'zod';

export const updateAssignmentStatusSchema = z
  .object({
    status: z.enum(['todo', 'in_progress']),
  })
  .strict();

export type UpdateAssignmentStatusDto = z.infer<typeof updateAssignmentStatusSchema>;

const httpsUrlSchema = z
  .string()
  .trim()
  .max(500, 'Each link must be 500 characters or fewer')
  .refine(
    (val) => {
      try {
        const parsed = new URL(val);
        return parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Each link must be a valid https:// URL' },
  );

export const createSubmissionSchema = z
  .object({
    note: z
      .string()
      .trim()
      .min(1, 'Submission note is required')
      .max(2000, 'Submission note must be 2000 characters or fewer'),
    links: z
      .array(httpsUrlSchema)
      .max(5, 'At most 5 links are allowed')
      .default([]),
  })
  .strict();

export type CreateSubmissionDto = z.infer<typeof createSubmissionSchema>;

export const listSubmissionsQuerySchema = z.object({
  reviewStatus: z.enum(['pending', 'approved', 'changes_requested', 'not_required']).optional(),
  departmentId: z.string().uuid('departmentId must be a valid UUID').optional(),
  employeeId: z.string().uuid('employeeId must be a valid UUID').optional(),
  taskId: z.string().uuid('taskId must be a valid UUID').optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListSubmissionsQueryDto = z.infer<typeof listSubmissionsQuerySchema>;

export const reviewSubmissionSchema = z
  .object({
    decision: z.enum(['approved', 'changes_requested']),
    note: z.string().trim().max(500, 'Review note must be 500 characters or fewer').optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.decision === 'changes_requested' && (!data.note || data.note.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'Review note is required when requesting changes',
      });
    }
  });

export type ReviewSubmissionDto = z.infer<typeof reviewSubmissionSchema>;

export const listCommentsQuerySchema = z.object({
  cursor: z.string().uuid('cursor must be a valid UUID').optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListCommentsQueryDto = z.infer<typeof listCommentsQuerySchema>;

export const createCommentSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, 'Comment body is required')
      .max(2000, 'Comment body must be 2000 characters or fewer'),
  })
  .strict();

export type CreateCommentDto = z.infer<typeof createCommentSchema>;
