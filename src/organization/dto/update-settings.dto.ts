import { z } from 'zod';

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const updateOrganizationSettingsSchema = z
  .object({
    workStart: z
      .string()
      .regex(timeRegex, 'workStart must be in 24-hour HH:mm format (e.g. 09:00)')
      .optional(),
    graceMinutes: z
      .number()
      .int('graceMinutes must be an integer')
      .min(0, 'graceMinutes cannot be negative')
      .max(180, 'graceMinutes cannot exceed 180 minutes')
      .optional(),
    workEnd: z
      .string()
      .regex(timeRegex, 'workEnd must be in 24-hour HH:mm format (e.g. 18:00)')
      .optional(),
    timezone: z
      .string()
      .min(1, 'Timezone is required')
      .max(100, 'Timezone cannot exceed 100 characters')
      .refine((tz) => {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid IANA timezone identifier (e.g. Asia/Dhaka, UTC)')
      .optional(),
    weekendDays: z
      .array(
        z
          .number()
          .int()
          .min(1, 'Weekend day must be between 1 (Monday) and 7 (Sunday)')
          .max(7, 'Weekend day must be between 1 (Monday) and 7 (Sunday)'),
      )
      .min(1, 'At least one weekend day is required')
      .max(7, 'Cannot exceed 7 weekend days')
      .refine(
        (days) => new Set(days).size === days.length,
        'weekendDays cannot contain duplicates',
      )
      .optional(),
  })
  .strict();

export type UpdateOrganizationSettingsDto = z.infer<typeof updateOrganizationSettingsSchema>;
