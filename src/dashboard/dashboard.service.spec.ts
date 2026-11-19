import { NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';
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
});
