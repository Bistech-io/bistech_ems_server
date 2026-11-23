import { z } from 'zod';

export const createDepartmentSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Department name is required')
      .max(100, 'Department name cannot exceed 100 characters'),
    description: z
      .string()
      .trim()
      .max(500, 'Description cannot exceed 500 characters')
      .optional()
      .nullable(),
  })
  .strict();

export type CreateDepartmentDto = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Department name is required')
      .max(100, 'Department name cannot exceed 100 characters')
      .optional(),
    description: z
      .string()
      .trim()
      .max(500, 'Description cannot exceed 500 characters')
      .optional()
      .nullable(),
  })
  .strict();

export type UpdateDepartmentDto = z.infer<typeof updateDepartmentSchema>;
