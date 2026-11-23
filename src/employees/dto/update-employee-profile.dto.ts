import { z } from 'zod';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const updateEmployeeProfileSchema = z
  .object({
    dateOfBirth: z
      .string()
      .regex(ISO_DATE_RE, 'dateOfBirth must be YYYY-MM-DD')
      .nullable()
      .optional(),
    personalEmail: z.string().trim().email('personalEmail must be a valid email').nullable().optional(),
    personalPhone: z.string().trim().max(30).nullable().optional(),
    addressLine: z.string().trim().max(255).nullable().optional(),
    city: z.string().trim().max(100).nullable().optional(),
    countryCode: z
      .string()
      .trim()
      .length(2, 'countryCode must be a 2-letter ISO code')
      .toUpperCase()
      .nullable()
      .optional(),
    emergencyContactName: z.string().trim().max(120).nullable().optional(),
    emergencyContactPhone: z.string().trim().max(30).nullable().optional(),
    emergencyContactRelation: z.string().trim().max(60).nullable().optional(),
  })
  .strict();

export type UpdateEmployeeProfileDto = z.infer<typeof updateEmployeeProfileSchema>;
