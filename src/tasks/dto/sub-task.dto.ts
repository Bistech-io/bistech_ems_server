import { z } from 'zod';

export const subTaskStatusSchema = z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED']);
export type SubTaskStatusValue = z.infer<typeof subTaskStatusSchema>;

export const createSubTaskSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Title is required')
      .max(200, 'Title cannot exceed 200 characters'),
    description: z
      .string()
      .trim()
      .max(2000, 'Description cannot exceed 2000 characters')
      .nullable()
      .optional(),
    status: subTaskStatusSchema.default('PENDING'),
  })
  .strict();

export type CreateSubTaskDto = z.infer<typeof createSubTaskSchema>;

export const updateSubTaskSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Title cannot be empty')
      .max(200, 'Title cannot exceed 200 characters')
      .optional(),
    description: z
      .string()
      .trim()
      .max(2000, 'Description cannot exceed 2000 characters')
      .nullable()
      .optional(),
    status: subTaskStatusSchema.optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.status !== undefined,
    { message: 'At least one of title, description, or status must be provided' },
  );

export type UpdateSubTaskDto = z.infer<typeof updateSubTaskSchema>;
