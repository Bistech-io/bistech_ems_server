import { z } from 'zod';

export const checkInSchema = z
  .object({
    note: z
      .string()
      .trim()
      .max(200, 'note must be 200 characters or fewer')
      .optional(),
  })
  .strict();

export type CheckInDto = z.infer<typeof checkInSchema>;
