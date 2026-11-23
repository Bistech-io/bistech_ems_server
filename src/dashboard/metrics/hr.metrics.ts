import {
  buildAttendanceBoard,
  getMonthStartIso,
  getOrgZonedParts,
  normalizeOrgSettings,
  toIsoDateString,
  type StoredAttendanceRow,
} from '../../attendance/absence.query.js';
import type { TaskStatusCountsDto } from '../dto/employee-dashboard.response.dto.js';
import type {
  DepartmentHeadcountDto,
  HrAuditFeedItemDto,
  HrDashboardResponseDto,
  HrRecentJoinerDto,
} from '../dto/hr-dashboard.response.dto.js';

export interface RawHrEmployeeRow {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  employmentStatus: 'active' | 'inactive';
  joiningDate: Date;
  exitDate: Date | null;
  departmentId: string;
  departmentName: string;
  designationTitle: string;
}

export interface RawOrgDepartmentRow {
  id: string;
  name: string;
}

export interface RawOrgTaskAssignmentRow {
  status: 'todo' | 'in_progress' | 'in_review' | 'changes_requested' | 'done' | 'cancelled';
  dueDate: Date | null;
}

export interface RawOrgAuditLogRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorName: string | null;
  createdAt: Date;
}

export interface ComputeHrDashboardInput {
  now: Date;
  timezone: string;
  settings: unknown;
  departments: RawOrgDepartmentRow[];
  employees: RawHrEmployeeRow[];
  holidayDates: Date[];
  monthAttendanceRows: (StoredAttendanceRow & { employeeId: string })[];
  taskAssignments: RawOrgTaskAssignmentRow[];
  openFeedbackCount: number;
  auditLogs: RawOrgAuditLogRow[];
}

function addDaysIso(isoDate: string, days: number): string {
  const ms = new Date(`${isoDate}T00:00:00Z`).getTime() + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Computes all HR Overview Dashboard metrics per FSD section 6:
 * - Total active/inactive employees, joiners this month, department summary
 * - Today's attendance breakdown (present, late, not_checked_in, absent)
 * - Org monthly attendance summary (reusing absence.query.ts)
 * - Org task counts by status (excluding cancelled), overdue, due soon, completion rate
 * - Open feedback count & recent audit feed
 */
export function computeHrDashboardMetrics(
  input: ComputeHrDashboardInput,
): HrDashboardResponseDto {
  const settings = normalizeOrgSettings(input.settings);
  const { dateStr: todayDateStr } = getOrgZonedParts(input.now, input.timezone);
  const monthStart = getMonthStartIso(todayDateStr);
  const currentMonthPrefix = todayDateStr.slice(0, 7);
  const dueSoonCutoff = addDaysIso(todayDateStr, 3);
  const holidaySet = new Set(input.holidayDates.map(toIsoDateString));
  const weekendSet = new Set(settings.weekendDays);

  const todayDow = new Date(`${todayDateStr}T00:00:00Z`).getUTCDay();
  const isWorkingDayToday = !weekendSet.has(todayDow) && !holidaySet.has(todayDateStr);

  // 1. Workforce & Department Summary
  let activeEmployees = 0;
  let inactiveEmployees = 0;
  let joinersThisMonth = 0;
  const deptCounts = new Map<string, number>();
  const recentJoinersList: HrRecentJoinerDto[] = [];

  for (const emp of input.employees) {
    if (emp.employmentStatus === 'active') {
      activeEmployees += 1;
      deptCounts.set(emp.departmentId, (deptCounts.get(emp.departmentId) ?? 0) + 1);
    } else {
      inactiveEmployees += 1;
    }

    const joinIso = toIsoDateString(emp.joiningDate);
    if (joinIso.startsWith(currentMonthPrefix)) {
      joinersThisMonth += 1;
      recentJoinersList.push({
        id: emp.id,
        employeeCode: emp.employeeCode,
        fullName: `${emp.firstName} ${emp.lastName}`.trim(),
        departmentName: emp.departmentName,
        designationTitle: emp.designationTitle,
        joiningDate: joinIso,
      });
    }
  }

  recentJoinersList.sort((a, b) => b.joiningDate.localeCompare(a.joiningDate));

  const departmentSummary: DepartmentHeadcountDto[] = input.departments.map((dept) => ({
    departmentId: dept.id,
    departmentName: dept.name,
    activeCount: deptCounts.get(dept.id) ?? 0,
  }));

  // 2. Attendance (Today + Org Monthly Summary)
  const rowsByEmployee = new Map<string, StoredAttendanceRow[]>();
  for (const row of input.monthAttendanceRows) {
    const list = rowsByEmployee.get(row.employeeId) ?? [];
    list.push(row);
    rowsByEmployee.set(row.employeeId, list);
  }

  let todayPresent = 0;
  let todayLate = 0;
  let todayNotCheckedIn = 0;
  let todayAbsent = 0;

  let monthlyPresentDays = 0;
  let monthlyLateDays = 0;
  let monthlyAbsentDays = 0;
  let monthlyExpectedDays = 0;

  for (const emp of input.employees) {
    const empRows = rowsByEmployee.get(emp.id) ?? [];
    const todayStoredRow =
      empRows.find((r) => toIsoDateString(r.workDate) === todayDateStr) ?? null;

    const board = buildAttendanceBoard({
      now: input.now,
      timezone: input.timezone,
      settings,
      from: monthStart,
      to: todayDateStr,
      joiningDate: toIsoDateString(emp.joiningDate),
      exitDate: emp.exitDate ? toIsoDateString(emp.exitDate) : null,
      isEmployeeActive: emp.employmentStatus === 'active',
      holidayDates: holidaySet,
      storedRows: empRows,
      todayStoredRow,
    });

    if (emp.employmentStatus === 'active' && toIsoDateString(emp.joiningDate) <= todayDateStr) {
      if (board.today.status === 'present') todayPresent += 1;
      else if (board.today.status === 'late') todayLate += 1;
      else if (board.today.status === 'absent') todayAbsent += 1;
      else if (isWorkingDayToday) todayNotCheckedIn += 1;
    }

    monthlyPresentDays += board.summary.presentDays;
    monthlyLateDays += board.summary.lateDays;
    monthlyAbsentDays += board.summary.absentDays;
    monthlyExpectedDays += board.summary.expectedWorkingDays;
  }

  const todayAttended = todayPresent + todayLate;
  const todayExpected = todayAttended + todayNotCheckedIn + todayAbsent;
  const todayRate =
    todayExpected > 0 ? Math.round((todayAttended / todayExpected) * 1000) / 10 : 100;

  const monthlyAttended = monthlyPresentDays + monthlyLateDays;
  const monthlyRate =
    monthlyExpectedDays > 0
      ? Math.round((monthlyAttended / monthlyExpectedDays) * 1000) / 10
      : 100;

  // 3. Tasks Summary
  const countsByStatus: TaskStatusCountsDto = {
    todo: 0,
    inProgress: 0,
    inReview: 0,
    changesRequested: 0,
    done: 0,
  };
  let overdueCount = 0;
  let dueSoonCount = 0;

  for (const task of input.taskAssignments) {
    if (task.status === 'cancelled') continue;

    if (task.status === 'todo') countsByStatus.todo += 1;
    else if (task.status === 'in_progress') countsByStatus.inProgress += 1;
    else if (task.status === 'in_review') countsByStatus.inReview += 1;
    else if (task.status === 'changes_requested') countsByStatus.changesRequested += 1;
    else if (task.status === 'done') countsByStatus.done += 1;

    const dueStr = task.dueDate ? toIsoDateString(task.dueDate) : null;
    const isOpen = task.status !== 'done';
    if (isOpen && dueStr && dueStr < todayDateStr) overdueCount += 1;
    if (isOpen && dueStr && dueStr >= todayDateStr && dueStr <= dueSoonCutoff) {
      dueSoonCount += 1;
    }
  }

  const openCount =
    countsByStatus.todo +
    countsByStatus.inProgress +
    countsByStatus.inReview +
    countsByStatus.changesRequested;
  const totalTasks = openCount + countsByStatus.done;
  const completionRatePercent =
    totalTasks > 0 ? Math.round((countsByStatus.done / totalTasks) * 100) : 100;

  // 4. Audit Feed
  const recentAuditLogs: HrAuditFeedItemDto[] = input.auditLogs.map((a) => ({
    id: a.id,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    actorName: a.actorName,
    createdAt: a.createdAt.toISOString(),
  }));

  return {
    timezone: input.timezone,
    workStart: settings.workStart,
    graceMinutes: settings.graceMinutes,
    workEnd: settings.workEnd,
    workforce: {
      activeEmployees,
      inactiveEmployees,
      joinersThisMonth,
      departmentSummary,
    },
    todayAttendance: {
      workDate: todayDateStr,
      isWorkingDay: isWorkingDayToday,
      presentCount: todayPresent,
      lateCount: todayLate,
      notCheckedInCount: todayNotCheckedIn,
      absentCount: todayAbsent,
      attendanceRatePercent: todayRate,
    },
    monthlyAttendance: {
      presentDays: monthlyPresentDays,
      lateDays: monthlyLateDays,
      absentDays: monthlyAbsentDays,
      expectedWorkingDays: monthlyExpectedDays,
      attendanceRatePercent: monthlyRate,
    },
    tasks: {
      countsByStatus,
      openCount,
      overdueCount,
      dueSoonCount,
      completionRatePercent,
    },
    openFeedbackCount: input.openFeedbackCount,
    recentJoiners: recentJoinersList.slice(0, 6),
    recentAuditLogs,
  };
}
