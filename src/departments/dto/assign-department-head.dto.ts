import { z } from 'zod';

export const assignDepartmentHeadSchema = z
  .object({
    employeeId: z.string().uuid('employeeId must be a valid UUID').nullable(),
  })
  .strict();

export type AssignDepartmentHeadDto = z.infer<typeof assignDepartmentHeadSchema>;
