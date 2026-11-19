import {
  buildAttendanceBoard,
  getMonthStartIso,
  getOrgZonedParts,
  normalizeOrgSettings,
  toIsoDateString,
  type StoredAttendanceRow,
} from '../../attendance/absence.query.js';
import type {
  EmployeeDashboardNotificationDto,
  EmployeeDashboardResponseDto,
  EmployeeDashboardTaskItemDto,
  TaskStatusCountsDto,
} from '../dto/employee-dashboard.response.dto.js';

export interface RawEmployeeDashboardProfile {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  employmentStatus: 'active' | 'inactive';
  joiningDate: Date;
  exitDate: Date | null;
  departmentName: string;
  designationTitle: string;
  teamNames: string[];
  timezone: string;
  settings: unknown;
}

export interface RawTaskAssignmentRow {
  id: string;
  taskId: string;
  status: 'todo' | 'in_progress' | 'in_review' | 'changes_requested' | 'done' | 'cancelled';
  title: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignmentType: 'self' | 'individual' | 'team';
  dueDate: Date | null;
  teamName: string | null;
  departmentName: string;
}

export interface RawNotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface ComputeEmployeeDashboardInput {
  now: Date;
  profile: RawEmployeeDashboardProfile;
  holidayDates: Date[];
  monthAttendanceRows: StoredAttendanceRow[];
  todayAttendanceRow: StoredAttendanceRow | null;
  taskAssignments: RawTaskAssignmentRow[];
  openFeedbackCount: number;
  notifications: RawNotificationRow[];
}

function addDaysIso(isoDate: string, days: number): string {
  const ms = new Date(`${isoDate}T00:00:00Z`).getTime() + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Computes all Employee Own Overview Dashboard metrics per FSD section 6:
 * - Today's attendance & monthly attendance summary (reusing absence.query.ts)
 * - Task counts by status (excluding cancelled), overdue, due soon (<= 3 days), completion rate
 * - Open feedback count & recent notifications
 */
export function computeEmployeeDashboardMetrics(
  input: ComputeEmployeeDashboardInput,
): EmployeeDashboardResponseDto {
  const settings = normalizeOrgSettings(input.profile.settings);
  const { dateStr: todayDateStr } = getOrgZonedParts(input.now, input.profile.timezone);
  const monthStart = getMonthStartIso(todayDateStr);
  const dueSoonCutoff = addDaysIso(todayDateStr, 3);

  const attendanceBoard = buildAttendanceBoard({
    now: input.now,
    timezone: input.profile.timezone,
    settings,
    from: monthStart,
    to: todayDateStr,
    joiningDate: toIsoDateString(input.profile.joiningDate),
    exitDate: input.profile.exitDate ? toIsoDateString(input.profile.exitDate) : null,
    isEmployeeActive: input.profile.employmentStatus === 'active',
    holidayDates: new Set(input.holidayDates.map(toIsoDateString)),
    storedRows: input.monthAttendanceRows,
    todayStoredRow: input.todayAttendanceRow,
  });

  const countsByStatus: TaskStatusCountsDto = {
    todo: 0,
    inProgress: 0,
    inReview: 0,
    changesRequested: 0,
    done: 0,
  };

  let overdueCount = 0;
  let dueSoonCount = 0;
  const items: EmployeeDashboardTaskItemDto[] = [];

  for (const row of input.taskAssignments) {
    if (row.status === 'cancelled') continue;

    if (row.status === 'todo') countsByStatus.todo += 1;
    else if (row.status === 'in_progress') countsByStatus.inProgress += 1;
    else if (row.status === 'in_review') countsByStatus.inReview += 1;
    else if (row.status === 'changes_requested') countsByStatus.changesRequested += 1;
    else if (row.status === 'done') countsByStatus.done += 1;

    const dueDateStr = row.dueDate ? toIsoDateString(row.dueDate) : null;
    const isOpen = row.status !== 'done';
    const isOverdue = Boolean(isOpen && dueDateStr && dueDateStr < todayDateStr);
    const isDueSoon = Boolean(
      isOpen && dueDateStr && dueDateStr >= todayDateStr && dueDateStr <= dueSoonCutoff,
    );

    if (isOverdue) overdueCount += 1;
    if (isDueSoon) dueSoonCount += 1;

    items.push({
      assignmentId: row.id,
      taskId: row.taskId,
      title: row.title,
      priority: row.priority,
      assignmentType: row.assignmentType,
      status: row.status,
      dueDate: dueDateStr,
      isOverdue,
      isDueSoon,
      teamName: row.teamName,
      departmentName: row.departmentName,
    });
  }

  const openCount =
    countsByStatus.todo +
    countsByStatus.inProgress +
    countsByStatus.inReview +
    countsByStatus.changesRequested;
  const totalCount = openCount + countsByStatus.done;
  const completionRatePercent =
    totalCount > 0 ? Math.round((countsByStatus.done / totalCount) * 100) : 100;

  const recentNotifications: EmployeeDashboardNotificationDto[] = input.notifications.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  }));

  return {
    employee: {
      id: input.profile.id,
      employeeCode: input.profile.employeeCode,
      fullName: `${input.profile.firstName} ${input.profile.lastName}`.trim(),
      workEmail: input.profile.workEmail,
      department: input.profile.departmentName,
      designation: input.profile.designationTitle,
      teams: input.profile.teamNames,
      timezone: input.profile.timezone,
      workStart: settings.workStart,
      graceMinutes: settings.graceMinutes,
      workEnd: settings.workEnd,
    },
    todayAttendance: attendanceBoard.today,
    monthlyAttendance: attendanceBoard.summary,
    tasks: {
      countsByStatus,
      openCount,
      overdueCount,
      dueSoonCount,
      completionRatePercent,
      items: items.slice(0, 15),
    },
    openFeedbackCount: input.openFeedbackCount,
    recentNotifications,
  };
}
