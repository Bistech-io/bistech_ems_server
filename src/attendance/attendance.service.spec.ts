import { ConflictException, NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';
import type { AttendanceRepository } from './attendance.repository.js';
import { AttendanceService } from './attendance.service.js';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const EMP_ID = '22222222-2222-2222-2222-222222222222';

function createMockRepo(overrides: Partial<AttendanceRepository> = {}): AttendanceRepository {
  return {
    findEmployeeContextByUserId: vi.fn().mockResolvedValue({
      organizationId: ORG_ID,
      timezone: 'Asia/Dhaka',
      settings: {
        workStart: '09:00',
        graceMinutes: 15,
        workEnd: '18:00',
        weekendDays: [5, 6],
      },
      employeeId: EMP_ID,
      employmentStatus: 'active',
      joiningDate: new Date('2026-11-01T00:00:00Z'),
      exitDate: null,
    }),
    findHolidayDates: vi.fn().mockResolvedValue([]),
    findRecordsInRange: vi.fn().mockResolvedValue([]),
    findRecordByDate: vi.fn().mockResolvedValue(null),
    createWebCheckIn: vi.fn().mockImplementation(async (input) => ({
      id: 'att-1',
      workDate: new Date(`${input.workDateIso}T00:00:00Z`),
      checkInAt: input.checkInAt,
      status: input.status,
      source: 'web',
      lateMinutes: input.lateMinutes,
      note: input.note ?? null,
    })),
    ...overrides,
  } as unknown as AttendanceRepository;
}

describe('AttendanceService', () => {
  it('records check-in using server clock and returns created record', async () => {
    const createWebCheckIn = vi.fn().mockImplementation(async (input) => ({
      id: 'att-1',
      workDate: new Date(`${input.workDateIso}T00:00:00Z`),
      checkInAt: input.checkInAt,
      status: input.status,
      source: 'web',
      lateMinutes: input.lateMinutes,
      note: input.note ?? null,
    }));
    const repo = createMockRepo({ createWebCheckIn });
    const service = new AttendanceService(repo);
    const now = new Date('2026-11-18T03:05:00Z');

    const record = await service.checkIn(ORG_ID, USER_ID, { note: 'Desk 4' }, now);

    expect(record).toMatchObject({
      id: 'att-1',
      workDate: '2026-11-18',
      status: 'present',
      source: 'web',
      lateMinutes: 0,
      note: 'Desk 4',
      isDerived: false,
    });
    expect(createWebCheckIn).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      employeeId: EMP_ID,
      workDateIso: '2026-11-18',
      checkInAt: now,
      status: 'present',
      lateMinutes: 0,
      note: 'Desk 4',
    });
  });

  it('throws 409 ALREADY_CHECKED_IN on second check-in same day', async () => {
    const repo = createMockRepo({
      findRecordByDate: vi.fn().mockResolvedValue({
        id: 'att-1',
        workDate: new Date('2026-11-18T00:00:00Z'),
        checkInAt: new Date('2026-11-18T03:05:00Z'),
        status: 'present',
        source: 'web',
        lateMinutes: 0,
        note: null,
      }),
    });
    const service = new AttendanceService(repo);

    await expect(
      service.checkIn(ORG_ID, USER_ID, {}, new Date('2026-11-18T03:20:00Z')),
    ).rejects.toThrow(ConflictException);
  });

  it('throws 404 when employee is not found for user in organization', async () => {
    const repo = createMockRepo({
      findEmployeeContextByUserId: vi.fn().mockResolvedValue(null),
    });
    const service = new AttendanceService(repo);

    await expect(
      service.getMyAttendanceBoard(ORG_ID, USER_ID, {}),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists org-wide attendance with derived absences and status filter for HR', async () => {
    const repo = createMockRepo({
      findOrganizationConfig: vi.fn().mockResolvedValue({
        timezone: 'Asia/Dhaka',
        settings: {
          workStart: '09:00',
          graceMinutes: 15,
          workEnd: '18:00',
          weekendDays: [5, 6],
        },
      }),
      findScopedEmployeesForAttendance: vi.fn().mockResolvedValue([
        {
          id: EMP_ID,
          userId: USER_ID,
          employeeCode: 'BST-1001',
          firstName: 'Nadia',
          lastName: 'Rahman',
          employmentStatus: 'active',
          joiningDate: new Date('2026-11-01T00:00:00Z'),
          exitDate: null,
          department: { id: 'dept-1', name: 'Engineering' },
          designation: { id: 'desig-1', title: 'Engineer' },
        },
      ]),
      findRecordsInRangeForEmployees: vi.fn().mockResolvedValue([
        {
          id: 'att-1',
          employeeId: EMP_ID,
          workDate: new Date('2026-11-17T00:00:00Z'),
          checkInAt: new Date('2026-11-17T03:00:00Z'),
          status: 'present',
          source: 'web',
          lateMinutes: 0,
          note: null,
        },
      ]),
    });
    const service = new AttendanceService(repo);
    const hrCaller = {
      userId: 'hr-user',
      organizationId: ORG_ID,
      sessionId: 'sess-1',
      roles: ['hr_manager'],
    };

    const result = await service.listAttendance(
      hrCaller,
      { from: '2026-11-16', to: '2026-11-17', page: 1, limit: 20 },
      new Date('2026-11-18T04:00:00Z'),
    );

    expect(result.meta.total).toBe(2);
    expect(result.items[0]).toMatchObject({
      workDate: '2026-11-17',
      status: 'present',
      isDerived: false,
    });
    expect(result.items[1]).toMatchObject({
      workDate: '2026-11-16',
      status: 'absent',
      isDerived: true,
    });
  });

  it('computes attendance summary grouped by day', async () => {
    const repo = createMockRepo({
      findOrganizationConfig: vi.fn().mockResolvedValue({
        timezone: 'Asia/Dhaka',
        settings: {
          workStart: '09:00',
          graceMinutes: 15,
          workEnd: '18:00',
          weekendDays: [5, 6],
        },
      }),
      findScopedEmployeesForAttendance: vi.fn().mockResolvedValue([
        {
          id: EMP_ID,
          userId: USER_ID,
          employeeCode: 'BST-1001',
          firstName: 'Nadia',
          lastName: 'Rahman',
          employmentStatus: 'active',
          joiningDate: new Date('2026-11-01T00:00:00Z'),
          exitDate: null,
          department: { id: 'dept-1', name: 'Engineering' },
          designation: { id: 'desig-1', title: 'Engineer' },
        },
      ]),
      findRecordsInRangeForEmployees: vi.fn().mockResolvedValue([
        {
          id: 'att-1',
          employeeId: EMP_ID,
          workDate: new Date('2026-11-17T00:00:00Z'),
          checkInAt: new Date('2026-11-17T03:30:00Z'),
          status: 'late',
          source: 'web',
          lateMinutes: 15,
          note: null,
        },
      ]),
    });
    const service = new AttendanceService(repo);
    const hrCaller = {
      userId: 'hr-user',
      organizationId: ORG_ID,
      sessionId: 'sess-1',
      roles: ['hr_manager'],
    };

    const summary = await service.getAttendanceSummary(
      hrCaller,
      { groupBy: 'day', from: '2026-11-17', to: '2026-11-17' },
      new Date('2026-11-18T04:00:00Z'),
    );

    expect(summary.totals).toEqual({
      presentCount: 0,
      lateCount: 1,
      absentCount: 0,
      expectedCount: 1,
      attendanceRatePercent: 100,
    });
    expect(summary.buckets).toHaveLength(1);
    expect(summary.buckets[0].period).toBe('2026-11-17');
  });

  it('returns 404 when employee requests another employee attendance record by id', async () => {
    const repo = createMockRepo({
      findHeadedDepartmentIds: vi.fn().mockResolvedValue({
        ownEmployeeId: 'other-emp-id',
        headedDepartmentIds: [],
      }),
      findStoredRecordById: vi.fn().mockResolvedValue({
        id: 'att-1',
        employeeId: EMP_ID,
        workDate: new Date('2026-11-17T00:00:00Z'),
        checkInAt: new Date('2026-11-17T03:00:00Z'),
        status: 'present',
        source: 'web',
        lateMinutes: 0,
        note: null,
        employee: {
          id: EMP_ID,
          userId: USER_ID,
          employeeCode: 'BST-1001',
          firstName: 'Nadia',
          lastName: 'Rahman',
          department: { id: 'dept-1', name: 'Engineering' },
          designation: { id: 'desig-1', title: 'Engineer' },
        },
      }),
    });
    const service = new AttendanceService(repo);
    const empCaller = {
      userId: 'other-user',
      organizationId: ORG_ID,
      sessionId: 'sess-2',
      roles: ['employee'],
    };

    await expect(service.getAttendanceById(empCaller, 'att-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
