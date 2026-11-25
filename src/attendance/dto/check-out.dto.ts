import { z } from 'zod';

export const checkOutSchema = z
  .object({
    note: z
      .string()
      .trim()
      .max(200, 'note must be 200 characters or fewer')
      .optional(),
  })
  .strict();

export type CheckOutDto = z.infer<typeof checkOutSchema>;
