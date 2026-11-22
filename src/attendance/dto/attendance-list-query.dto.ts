import { z } from 'zod';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const attendanceListQuerySchema = z
  .object({
    employeeId: z.string().uuid('employeeId must be a valid UUID').optional(),
    departmentId: z.string().uuid('departmentId must be a valid UUID').optional(),
    from: z.string().regex(ISO_DATE_RE, 'from must be a valid YYYY-MM-DD date').optional(),
    to: z.string().regex(ISO_DATE_RE, 'to must be a valid YYYY-MM-DD date').optional(),
    status: z.enum(['present', 'late', 'absent']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((data) => !(data.from && data.to && data.from > data.to), {
    message: 'from must be on or before to',
    path: ['from'],
  });

export type AttendanceListQueryDto = z.infer<typeof attendanceListQuerySchema>;

export const attendanceSummaryQuerySchema = z
  .object({
    groupBy: z.enum(['day', 'month']).default('day'),
    employeeId: z.string().uuid('employeeId must be a valid UUID').optional(),
    departmentId: z.string().uuid('departmentId must be a valid UUID').optional(),
    from: z.string().regex(ISO_DATE_RE, 'from must be a valid YYYY-MM-DD date').optional(),
    to: z.string().regex(ISO_DATE_RE, 'to must be a valid YYYY-MM-DD date').optional(),
  })
  .refine((data) => !(data.from && data.to && data.from > data.to), {
    message: 'from must be on or before to',
    path: ['from'],
  });

export type AttendanceSummaryQueryDto = z.infer<typeof attendanceSummaryQuerySchema>;

export interface HrAttendanceListItemDto {
  id: string | null;
  workDate: string;
  checkInAt: string | null;
  status: 'present' | 'late' | 'absent';
  source: 'web' | 'hr_correction' | null;
  lateMinutes: number;
  note: string | null;
  isDerived: boolean;
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    department: { id: string; name: string };
    designation: { id: string; title: string };
  };
}

export interface AttendanceSummaryBucketDto {
  period: string;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  expectedCount: number;
  attendanceRatePercent: number;
}

export interface AttendanceSummaryResponseDto {
  groupBy: 'day' | 'month';
  from: string;
  to: string;
  timezone: string;
  totals: {
    presentCount: number;
    lateCount: number;
    absentCount: number;
    expectedCount: number;
    attendanceRatePercent: number;
  };
  buckets: AttendanceSummaryBucketDto[];
}
