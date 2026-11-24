import { z } from 'zod';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const updateEmployeeProfileSchema = z
  .object({
    dateOfBirth: z.preprocess(
      emptyToNull,
      z
        .string()
        .regex(ISO_DATE_RE, 'dateOfBirth must be YYYY-MM-DD')
        .nullable()
        .optional(),
    ),
    personalEmail: z.preprocess(
      emptyToNull,
      z.string().trim().email('personalEmail must be a valid email').nullable().optional(),
    ),
    personalPhone: z.preprocess(emptyToNull, z.string().trim().max(30).nullable().optional()),
    addressLine: z.preprocess(emptyToNull, z.string().trim().max(255).nullable().optional()),
    city: z.preprocess(emptyToNull, z.string().trim().max(100).nullable().optional()),
    countryCode: z.preprocess(
      emptyToNull,
      z
        .string()
        .trim()
        .length(2, 'countryCode must be a 2-letter ISO code')
        .toUpperCase()
        .nullable()
        .optional(),
    ),
    emergencyContactName: z.preprocess(
      emptyToNull,
      z.string().trim().max(120).nullable().optional(),
    ),
    emergencyContactPhone: z.preprocess(
      emptyToNull,
      z.string().trim().max(30).nullable().optional(),
    ),
    emergencyContactRelation: z.preprocess(
      emptyToNull,
      z.string().trim().max(60).nullable().optional(),
    ),
  })
  .strict();

export type UpdateEmployeeProfileDto = z.infer<typeof updateEmployeeProfileSchema>;
