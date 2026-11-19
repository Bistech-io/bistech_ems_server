import { Injectable, NotFoundException } from '@nestjs/common';
import {
  getMonthStartIso,
  getOrgZonedParts,
  toIsoDateString,
} from '../attendance/absence.query.js';
import { DashboardRepository } from './dashboard.repository.js';
import type { EmployeeDashboardResponseDto } from './dto/employee-dashboard.response.dto.js';
import { computeEmployeeDashboardMetrics } from './metrics/employee.metrics.js';

@Injectable()
export class DashboardService {
  constructor(private readonly dashboardRepo: DashboardRepository) {}

  async getMyOverviewDashboard(
    organizationId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<EmployeeDashboardResponseDto> {
    const profile = await this.dashboardRepo.findEmployeeProfileByUserId(
      organizationId,
      userId,
    );
    if (!profile) {
      throw new NotFoundException({
        code: 'EMPLOYEE_NOT_FOUND',
        message: 'Employee profile not found for current user',
      });
    }

    const { dateStr: todayDateStr } = getOrgZonedParts(now, profile.timezone);
    const monthStart = getMonthStartIso(todayDateStr);

    const [
      holidayDates,
      monthAttendanceRows,
      taskAssignments,
      openFeedbackCount,
      notifications,
    ] = await Promise.all([
      this.dashboardRepo.findHolidayDates(organizationId, monthStart, todayDateStr),
      this.dashboardRepo.findAttendanceInRange(
        organizationId,
        profile.id,
        monthStart,
        todayDateStr,
      ),
      this.dashboardRepo.findTaskAssignments(organizationId, profile.id),
      this.dashboardRepo.countOpenFeedbackByUser(organizationId, userId),
      this.dashboardRepo.findRecentNotifications(organizationId, userId),
    ]);

    const todayAttendanceRow =
      monthAttendanceRows.find((row) => toIsoDateString(row.workDate) === todayDateStr) ?? null;

    return computeEmployeeDashboardMetrics({
      now,
      profile,
      holidayDates,
      monthAttendanceRows,
      todayAttendanceRow,
      taskAssignments,
      openFeedbackCount,
      notifications,
    });
  }
}
