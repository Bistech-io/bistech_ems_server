import type { MonthlyAttendanceSummaryDto } from '../../attendance/index.js';
import type { TaskStatusCountsDto } from './employee-dashboard.response.dto.js';

export interface DepartmentHeadcountDto {
  departmentId: string;
  departmentName: string;
  activeCount: number;
}

export interface HrWorkforceSummaryDto {
  activeEmployees: number;
  inactiveEmployees: number;
  joinersThisMonth: number;
  departmentSummary: DepartmentHeadcountDto[];
}

export interface HrTodayAttendanceSummaryDto {
  workDate: string;
  isWorkingDay: boolean;
  presentCount: number;
  lateCount: number;
  notCheckedInCount: number;
  absentCount: number;
  attendanceRatePercent: number;
}

export interface HrTasksSummaryDto {
  countsByStatus: TaskStatusCountsDto;
  openCount: number;
  overdueCount: number;
  dueSoonCount: number;
  completionRatePercent: number;
}

export interface HrRecentJoinerDto {
  id: string;
  employeeCode: string;
  fullName: string;
  departmentName: string;
  designationTitle: string;
  joiningDate: string;
}

export interface HrAuditFeedItemDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface HrDashboardResponseDto {
  timezone: string;
  workStart: string;
  graceMinutes: number;
  workEnd: string;
  workforce: HrWorkforceSummaryDto;
  todayAttendance: HrTodayAttendanceSummaryDto;
  monthlyAttendance: MonthlyAttendanceSummaryDto;
  tasks: HrTasksSummaryDto;
  openFeedbackCount: number;
  recentJoiners: HrRecentJoinerDto[];
  recentAuditLogs: HrAuditFeedItemDto[];
}
