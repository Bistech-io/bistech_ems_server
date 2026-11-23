import { z } from 'zod';

export const updateEmployeeSchema = z
  .object({
    designationId: z.string().uuid('designationId must be a valid UUID').optional(),
    designationTitle: z.string().trim().min(1).max(100).optional(),
    departmentId: z.string().uuid('departmentId must be a valid UUID').optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export type UpdateEmployeeDto = z.infer<typeof updateEmployeeSchema>;
