import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import type { DashboardRepository } from './dashboard.repository.js';
import { DashboardService } from './dashboard.service.js';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '33333333-3333-3333-3333-333333333333';

function createMockRepo(overrides: Partial<DashboardRepository> = {}): DashboardRepository {
  return {
    findEmployeeProfileByUserId: vi.fn().mockResolvedValue({
      id: 'emp-1',
      employeeCode: 'BST-00142',
      firstName: 'Nadia',
      lastName: 'Rahman',
      workEmail: 'nadia@bistech.io',
      employmentStatus: 'active',
      joiningDate: new Date('2026-11-01T00:00:00Z'),
      exitDate: null,
      departmentName: 'Engineering',
      designationTitle: 'Senior Frontend Engineer',
      teamNames: ['Core Platform Squad'],
      timezone: 'Asia/Dhaka',
      settings: {
        workStart: '09:00',
        graceMinutes: 15,
        workEnd: '18:00',
        weekendDays: [5, 6],
      },
    }),
    findHolidayDates: vi.fn().mockResolvedValue([]),
    findAttendanceInRange: vi.fn().mockResolvedValue([
      {
        id: 'att-today',
        workDate: new Date('2026-11-18T00:00:00Z'),
        checkInAt: new Date('2026-11-18T03:00:00Z'),
        status: 'present',
        source: 'web',
        lateMinutes: 0,
        note: null,
      },
    ]),
    findTaskAssignments: vi.fn().mockResolvedValue([]),
    countOpenFeedbackByUser: vi.fn().mockResolvedValue(1),
    findRecentNotifications: vi.fn().mockResolvedValue([]),
    findOrganizationConfig: vi.fn().mockResolvedValue({
      timezone: 'Asia/Dhaka',
      settings: {
        workStart: '09:00',
        graceMinutes: 15,
        workEnd: '18:00',
        weekendDays: [5, 6],
      },
    }),
    findOrgDepartments: vi.fn().mockResolvedValue([{ id: 'dept-1', name: 'Engineering' }]),
    findOrgEmployeesForHrDashboard: vi.fn().mockResolvedValue([]),
    findOrgAttendanceInRange: vi.fn().mockResolvedValue([]),
    findOrgTaskAssignments: vi.fn().mockResolvedValue([]),
    countOrgOpenFeedback: vi.fn().mockResolvedValue(3),
    findRecentOrgAuditLogs: vi.fn().mockResolvedValue([]),
    countActiveTeams: vi.fn().mockResolvedValue(2),
    countDepartmentsWithHead: vi.fn().mockResolvedValue(1),
    countPendingReviewsExcludingUser: vi.fn().mockResolvedValue(4),
    countOrgOpenFeedbackByKind: vi.fn().mockResolvedValue({ issues: 2, suggestions: 1 }),
    ...overrides,
  } as unknown as DashboardRepository;
}

describe('DashboardService', () => {
  it('returns computed employee overview dashboard payload', async () => {
    const repo = createMockRepo();
    const service = new DashboardService(repo);
    const now = new Date('2026-11-18T04:00:00Z');

    const dashboard = await service.getMyOverviewDashboard(ORG_ID, USER_ID, now);

    expect(dashboard.employee.employeeCode).toBe('BST-00142');
    expect(dashboard.todayAttendance.status).toBe('present');
    expect(dashboard.openFeedbackCount).toBe(1);
  });

  it('throws 404 when employee profile does not exist for user', async () => {
    const repo = createMockRepo({
      findEmployeeProfileByUserId: vi.fn().mockResolvedValue(null),
    });
    const service = new DashboardService(repo);

    await expect(
      service.getMyOverviewDashboard(ORG_ID, USER_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns HR overview dashboard for HR manager', async () => {
    const repo = createMockRepo();
    const service = new DashboardService(repo);
    const hrCaller: AuthenticatedUser = {
      userId: USER_ID,
      organizationId: ORG_ID,
      sessionId: 'sess-hr',
      roles: ['hr_manager'],
    };

    const hrDashboard = await service.getHrOverviewDashboard(
      hrCaller,
      new Date('2026-11-18T04:00:00Z'),
    );

    expect(hrDashboard.openFeedbackCount).toBe(3);
    expect(hrDashboard.workforce.departmentSummary).toHaveLength(1);
  });

  it('throws 403 FORBIDDEN when non-HR employee requests HR overview dashboard', async () => {
    const repo = createMockRepo();
    const service = new DashboardService(repo);
    const empCaller: AuthenticatedUser = {
      userId: USER_ID,
      organizationId: ORG_ID,
      sessionId: 'sess-emp',
      roles: ['employee'],
    };

    await expect(service.getHrOverviewDashboard(empCaller)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns company dashboard for Super Admin', async () => {
    const repo = createMockRepo();
    const service = new DashboardService(repo);
    const adminCaller: AuthenticatedUser = {
      userId: USER_ID,
      organizationId: ORG_ID,
      sessionId: 'sess-admin',
      roles: ['super_admin'],
    };

    const companyDashboard = await service.getCompanyDashboard(
      adminCaller,
      new Date('2026-11-18T04:00:00Z'),
    );

    expect(companyDashboard.governance).toEqual({
      activeTeamsCount: 2,
      totalDepartments: 1,
      departmentsWithHead: 1,
      pendingReviewsCount: 4,
    });
    expect(companyDashboard.feedbackBreakdown).toEqual({
      openTotal: 3,
      issues: 2,
      suggestions: 1,
    });
  });

  it('throws 403 FORBIDDEN when HR Manager requests company dashboard', async () => {
    const repo = createMockRepo();
    const service = new DashboardService(repo);
    const hrCaller: AuthenticatedUser = {
      userId: USER_ID,
      organizationId: ORG_ID,
      sessionId: 'sess-hr',
      roles: ['hr_manager'],
    };

    await expect(service.getCompanyDashboard(hrCaller)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns summary overview for Super Admin even without an employee profile', async () => {
    const repo = createMockRepo({
      findEmployeeProfileByUserId: vi.fn().mockResolvedValue(null),
    });
    const service = new DashboardService(repo);
    const adminCaller: AuthenticatedUser = {
      userId: USER_ID,
      organizationId: ORG_ID,
      sessionId: 'sess-admin',
      roles: ['super_admin'],
    };

    const summary = await service.getSummaryDashboard(
      adminCaller,
      new Date('2026-11-18T04:00:00Z'),
    );

    expect(summary.primaryRole).toBe('super_admin');
    expect(summary.availableViews).toEqual(['company', 'hr', 'me']);
    expect(summary.company).not.toBeNull();
    expect(summary.me).toBeNull();
  });

  it('returns summary overview for regular employee with me view only', async () => {
    const repo = createMockRepo();
    const service = new DashboardService(repo);
    const empCaller: AuthenticatedUser = {
      userId: USER_ID,
      organizationId: ORG_ID,
      sessionId: 'sess-emp',
      roles: ['employee'],
    };

    const summary = await service.getSummaryDashboard(
      empCaller,
      new Date('2026-11-18T04:00:00Z'),
    );

    expect(summary.primaryRole).toBe('employee');
    expect(summary.availableViews).toEqual(['me']);
    expect(summary.company).toBeNull();
    expect(summary.hr).toBeNull();
    expect(summary.me?.employee.employeeCode).toBe('BST-00142');
  });
});
