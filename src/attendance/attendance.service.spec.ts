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
});
