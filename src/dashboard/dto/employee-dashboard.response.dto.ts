import type {
  MonthlyAttendanceSummaryDto,
  TodayAttendanceDto,
} from '../../attendance/index.js';

export interface EmployeeDashboardProfileDto {
  id: string;
  employeeCode: string;
  fullName: string;
  workEmail: string;
  department: string;
  designation: string;
  teams: string[];
  timezone: string;
  workStart: string;
  graceMinutes: number;
  workEnd: string;
}

export interface TaskStatusCountsDto {
  todo: number;
  inProgress: number;
  inReview: number;
  changesRequested: number;
  done: number;
}

export interface EmployeeDashboardTaskItemDto {
  assignmentId: string;
  taskId: string;
  title: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignmentType: 'self' | 'individual' | 'team';
  status: 'todo' | 'in_progress' | 'in_review' | 'changes_requested' | 'done';
  dueDate: string | null;
  isOverdue: boolean;
  isDueSoon: boolean;
  teamName: string | null;
  departmentName: string;
}

export interface EmployeeDashboardTasksSummaryDto {
  countsByStatus: TaskStatusCountsDto;
  openCount: number;
  overdueCount: number;
  dueSoonCount: number;
  completionRatePercent: number;
  items: EmployeeDashboardTaskItemDto[];
}

export interface EmployeeDashboardNotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface EmployeeDashboardResponseDto {
  employee: EmployeeDashboardProfileDto;
  todayAttendance: TodayAttendanceDto;
  monthlyAttendance: MonthlyAttendanceSummaryDto;
  tasks: EmployeeDashboardTasksSummaryDto;
  openFeedbackCount: number;
  recentNotifications: EmployeeDashboardNotificationDto[];
}
