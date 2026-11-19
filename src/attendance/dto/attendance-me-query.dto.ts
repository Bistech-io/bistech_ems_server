import { z } from 'zod';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const attendanceMeQuerySchema = z
  .object({
    from: z.string().regex(ISO_DATE_RE, 'from must be a valid YYYY-MM-DD date').optional(),
    to: z.string().regex(ISO_DATE_RE, 'to must be a valid YYYY-MM-DD date').optional(),
  })
  .refine(
    (data) => !(data.from && data.to && data.from > data.to),
    {
      message: 'from must be on or before to',
      path: ['from'],
    },
  );

export type AttendanceMeQueryDto = z.infer<typeof attendanceMeQuerySchema>;
