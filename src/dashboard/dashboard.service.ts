import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import {
  getMonthStartIso,
  getOrgZonedParts,
  toIsoDateString,
} from '../attendance/absence.query.js';
import { DashboardRepository } from './dashboard.repository.js';
import type { EmployeeDashboardResponseDto } from './dto/employee-dashboard.response.dto.js';
import type { HrDashboardResponseDto } from './dto/hr-dashboard.response.dto.js';
import type { CompanyDashboardResponseDto } from './dto/company-dashboard.response.dto.js';
import { computeCompanyDashboardMetrics } from './metrics/company.metrics.js';
import { computeEmployeeDashboardMetrics } from './metrics/employee.metrics.js';
import { computeHrDashboardMetrics } from './metrics/hr.metrics.js';

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

  async getHrOverviewDashboard(
    caller: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<HrDashboardResponseDto> {
    const isHrOrAdmin =
      caller.roles.includes('super_admin') || caller.roles.includes('hr_manager');

    if (!isHrOrAdmin) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only HR Managers or Super Admins can access the HR overview dashboard',
      });
    }

    const org = await this.dashboardRepo.findOrganizationConfig(caller.organizationId);
    if (!org) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Organization not found',
      });
    }

    const { dateStr: todayDateStr } = getOrgZonedParts(now, org.timezone);
    const monthStart = getMonthStartIso(todayDateStr);

    const [
      departments,
      employees,
      holidayDates,
      monthAttendanceRows,
      taskAssignments,
      openFeedbackCount,
      auditLogs,
    ] = await Promise.all([
      this.dashboardRepo.findOrgDepartments(caller.organizationId),
      this.dashboardRepo.findOrgEmployeesForHrDashboard(caller.organizationId),
      this.dashboardRepo.findHolidayDates(caller.organizationId, monthStart, todayDateStr),
      this.dashboardRepo.findOrgAttendanceInRange(
        caller.organizationId,
        monthStart,
        todayDateStr,
      ),
      this.dashboardRepo.findOrgTaskAssignments(caller.organizationId),
      this.dashboardRepo.countOrgOpenFeedback(caller.organizationId),
      this.dashboardRepo.findRecentOrgAuditLogs(caller.organizationId),
    ]);

    return computeHrDashboardMetrics({
      now,
      timezone: org.timezone,
      settings: org.settings,
      departments,
      employees,
      holidayDates,
      monthAttendanceRows,
      taskAssignments,
      openFeedbackCount,
      auditLogs,
    });
  }

  async getCompanyDashboard(
    caller: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<CompanyDashboardResponseDto> {
    if (!caller.roles.includes('super_admin')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only Super Admins can access the company dashboard',
      });
    }

    const org = await this.dashboardRepo.findOrganizationConfig(caller.organizationId);
    if (!org) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Organization not found',
      });
    }

    const { dateStr: todayDateStr } = getOrgZonedParts(now, org.timezone);
    const monthStart = getMonthStartIso(todayDateStr);

    const [
      departments,
      employees,
      holidayDates,
      monthAttendanceRows,
      taskAssignments,
      feedbackByKind,
      auditLogs,
      activeTeamsCount,
      departmentsWithHead,
      pendingReviewsCount,
    ] = await Promise.all([
      this.dashboardRepo.findOrgDepartments(caller.organizationId),
      this.dashboardRepo.findOrgEmployeesForHrDashboard(caller.organizationId),
      this.dashboardRepo.findHolidayDates(caller.organizationId, monthStart, todayDateStr),
      this.dashboardRepo.findOrgAttendanceInRange(
        caller.organizationId,
        monthStart,
        todayDateStr,
      ),
      this.dashboardRepo.findOrgTaskAssignments(caller.organizationId),
      this.dashboardRepo.countOrgOpenFeedbackByKind(caller.organizationId),
      this.dashboardRepo.findRecentOrgAuditLogs(caller.organizationId),
      this.dashboardRepo.countActiveTeams(caller.organizationId),
      this.dashboardRepo.countDepartmentsWithHead(caller.organizationId),
      this.dashboardRepo.countPendingReviewsExcludingUser(
        caller.organizationId,
        caller.userId,
      ),
    ]);

    return computeCompanyDashboardMetrics({
      now,
      timezone: org.timezone,
      settings: org.settings,
      departments,
      employees,
      holidayDates,
      monthAttendanceRows,
      taskAssignments,
      openFeedbackCount: feedbackByKind.issues + feedbackByKind.suggestions,
      auditLogs,
      activeTeamsCount,
      departmentsWithHead,
      pendingReviewsCount,
      openIssuesCount: feedbackByKind.issues,
      openSuggestionsCount: feedbackByKind.suggestions,
    });
  }
}
