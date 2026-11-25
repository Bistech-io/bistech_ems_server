import { z } from 'zod';

export const createEmployeeSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required').max(80),
    lastName: z.string().trim().min(1, 'Last name is required').max(80),
    username: z
      .string()
      .trim()
      .min(2, 'Username must be at least 2 characters')
      .toLowerCase()
      .optional(),
    workEmail: z.string().trim().email('Enter a valid work email address'),
    phone: z.string().trim().optional(),
    departmentId: z.string().uuid('Invalid department ID'),
    designationId: z.string().uuid('Invalid designation ID'),
    employmentType: z.enum(['full_time', 'part_time', 'contract', 'intern']),
    joiningDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Joining date must be in YYYY-MM-DD format'),
    roles: z
      .array(z.enum(['employee', 'hr_manager', 'dept_head', 'department_head']))
      .optional()
      .default(['employee']),
    password: z.string().min(6).optional(),
    personalProfile: z
      .object({
        dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        personalEmail: z.string().email().optional(),
        personalPhone: z.string().optional(),
        addressLine: z.string().optional(),
        city: z.string().optional(),
        countryCode: z.string().length(2).optional(),
        emergencyContactName: z.string().optional(),
        emergencyContactPhone: z.string().optional(),
        emergencyContactRelation: z.string().optional(),
      })
      .optional(),
  })
  .strict();

export type CreateEmployeeDto = z.infer<typeof createEmployeeSchema>;

