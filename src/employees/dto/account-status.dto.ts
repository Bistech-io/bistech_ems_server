import { z } from 'zod';

export const updateEmployeeAccountStatusSchema = z
  .object({
    frozen: z.boolean(),
    reason: z
      .string()
      .trim()
      .max(300, 'reason cannot exceed 300 characters')
      .optional(),
  })
  .strict();

export type UpdateEmployeeAccountStatusDto = z.infer<
  typeof updateEmployeeAccountStatusSchema
>;
