export type AttendanceRecordStatus = 'present' | 'late' | 'absent';
export type TodayAttendanceStatus = AttendanceRecordStatus | 'not_checked_in';
export type AttendanceSource = 'web' | 'hr_correction';

export interface AttendanceRecordDto {
  id: string | null;
  workDate: string;
  checkInAt: string | null;
  status: AttendanceRecordStatus;
  source: AttendanceSource | null;
  lateMinutes: number;
  note: string | null;
  isDerived: boolean;
}

export interface TodayAttendanceDto {
  workDate: string;
  status: TodayAttendanceStatus;
  checkInAt: string | null;
  lateMinutes: number;
  source: AttendanceSource | null;
}

export interface MonthlyAttendanceSummaryDto {
  presentDays: number;
  lateDays: number;
  absentDays: number;
  expectedWorkingDays: number;
  attendanceRatePercent: number;
}

export interface AttendanceBoardResponseDto {
  timezone: string;
  workStart: string;
  graceMinutes: number;
  workEnd: string;
  from: string;
  to: string;
  today: TodayAttendanceDto;
  summary: MonthlyAttendanceSummaryDto;
  records: AttendanceRecordDto[];
}
