import { z } from 'zod';

export const feedbackKindSchema = z.enum(['issue', 'suggestion']);
export const feedbackCategorySchema = z.enum([
  'general',
  'attendance',
  'tasks',
  'system',
  'workplace',
  'other',
]);
export const feedbackStatusSchema = z.enum(['open', 'in_review', 'resolved', 'closed']);

export const createFeedbackSchema = z
  .object({
    isNotice: z.boolean().default(false),
    kind: feedbackKindSchema.default('suggestion'),
    category: feedbackCategorySchema.default('general'),
    subject: z
      .string()
      .trim()
      .min(5, 'Subject must be at least 5 characters')
      .max(150, 'Subject cannot exceed 150 characters'),
    body: z
      .string()
      .trim()
      .min(10, 'Description must be at least 10 characters')
      .max(4000, 'Description cannot exceed 4000 characters'),
  })
  .strict();

export type CreateFeedbackDto = z.infer<typeof createFeedbackSchema>;

const optionalBooleanQuerySchema = z.preprocess((val) => {
  if (val === 'true' || val === true) return true;
  if (val === 'false' || val === false) return false;
  return val;
}, z.boolean().optional());

export const listFeedbackQuerySchema = z.object({
  isNotice: optionalBooleanQuerySchema,
  kind: feedbackKindSchema.optional(),
  category: feedbackCategorySchema.optional(),
  status: feedbackStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListFeedbackQueryDto = z.infer<typeof listFeedbackQuerySchema>;

export const updateFeedbackSchema = z
  .object({
    status: feedbackStatusSchema.optional(),
    resolutionNote: z
      .string()
      .trim()
      .max(2000, 'Resolution note cannot exceed 2000 characters')
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (data) => data.status !== undefined || data.resolutionNote !== undefined,
    { message: 'At least one of status or resolutionNote must be provided' },
  );

export type UpdateFeedbackDto = z.infer<typeof updateFeedbackSchema>;

export const createFeedbackCommentSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, 'Comment body is required')
      .max(2000, 'Comment cannot exceed 2000 characters'),
  })
  .strict();

export type CreateFeedbackCommentDto = z.infer<typeof createFeedbackCommentSchema>;

export const updateFeedbackCommentSchema = createFeedbackCommentSchema;
export type UpdateFeedbackCommentDto = CreateFeedbackCommentDto;

export const listFeedbackCommentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListFeedbackCommentsQueryDto = z.infer<
  typeof listFeedbackCommentsQuerySchema
>;
