import { z } from 'zod';
import { isValidIpOrCidr, normalizeIpOrCidr } from '../../common/utils/ip.util.js';

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const allowedOfficeIpsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, 'IP address cannot be empty')
      .max(64, 'IP address or CIDR entry is too long')
      .refine(
        (val) => isValidIpOrCidr(val),
        'Each office IP must be a valid IPv4, IPv6, or CIDR address (e.g. 203.0.113.10 or 203.0.113.0/24)',
      ),
  )
  .max(50, 'Cannot configure more than 50 office IP addresses')
  .transform((ips) =>
    Array.from(
      new Set(
        ips
          .map((ip) => normalizeIpOrCidr(ip))
          .filter((ip): ip is string => ip !== null),
      ),
    ),
  );

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
    allowedOfficeIps: allowedOfficeIpsSchema.optional(),
  })
  .strict();

export type UpdateOrganizationSettingsDto = z.infer<typeof updateOrganizationSettingsSchema>;
