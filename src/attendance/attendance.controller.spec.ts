import { type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard.js';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceRepository } from './attendance.repository.js';
import { AttendanceService } from './attendance.service.js';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const EMP_ID = '33333333-3333-3333-3333-333333333333';

const CALLER: AuthenticatedUser = {
  userId: USER_ID,
  organizationId: ORG_ID,
  sessionId: 'sess-1',
  roles: ['employee'],
};

describe('AttendanceController Check-out (HTTP)', () => {
  let app: INestApplication;
  let storedTodayRow: {
    id: string;
    workDate: Date;
    checkInAt: Date | null;
    checkOutAt: Date | null;
    status: 'present' | 'late' | 'absent';
    source: 'web' | 'hr_correction';
    lateMinutes: number;
    note: string | null;
  } | null;

  beforeEach(async () => {
    storedTodayRow = null;

    const repoMock = {
      findEmployeeContextByUserId: vi.fn().mockResolvedValue({
        organizationId: ORG_ID,
        timezone: 'Asia/Dhaka',
        settings: {
          workStart: '10:00',
          graceMinutes: 15,
          workEnd: '18:30',
          weekendDays: [5, 6],
        },
        employeeId: EMP_ID,
        employmentStatus: 'active',
        joiningDate: new Date('2026-11-01T00:00:00Z'),
        exitDate: null,
      }),
      findHolidayDates: vi.fn().mockResolvedValue([]),
      findRecordsInRange: vi.fn(async () => (storedTodayRow ? [storedTodayRow] : [])),
      findRecordByDate: vi.fn(async () => storedTodayRow),
      findFirstCheckInDate: vi.fn(async () =>
        storedTodayRow ? storedTodayRow.workDate : null,
      ),
      createWebCheckIn: vi.fn(async (input) => {
        storedTodayRow = {
          id: 'att-1',
          workDate: new Date(`${input.workDateIso}T00:00:00Z`),
          checkInAt: input.checkInAt,
          checkOutAt: null,
          status: input.status,
          source: 'web',
          lateMinutes: input.lateMinutes,
          note: input.note ?? null,
        };
        return storedTodayRow;
      }),
      recordWebCheckOut: vi.fn(async (input) => {
        storedTodayRow = {
          ...storedTodayRow!,
          checkOutAt: input.checkOutAt,
          note: input.note !== undefined ? input.note : storedTodayRow!.note,
        };
        return storedTodayRow;
      }),
    };

    const mockGuard: CanActivate = {
      canActivate(ctx: ExecutionContext) {
        const req = ctx.switchToHttp().getRequest();
        req.user = CALLER;
        return true;
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AttendanceController],
      providers: [
        AttendanceService,
        { provide: AttendanceRepository, useValue: repoMock },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue(mockGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects check-out before check-in (409), validates body (400), records check-out (200), and blocks duplicate (409)', async () => {
    // 1. Check-out before check-in -> 409 NOT_CHECKED_IN
    const beforeCheckIn = await request(app.getHttpServer())
      .post('/api/v1/attendance/check-out')
      .send({})
      .expect(409);
    expect(beforeCheckIn.body.success).toBe(false);
    expect(beforeCheckIn.body.error.code).toBe('NOT_CHECKED_IN');

    // 2. Invalid payload (unknown field rejected by .strict()) -> 400 VALIDATION_ERROR
    const invalidRes = await request(app.getHttpServer())
      .post('/api/v1/attendance/check-out')
      .send({ unknownField: true })
      .expect(400);
    expect(invalidRes.body.success).toBe(false);
    expect(invalidRes.body.error.code).toBe('VALIDATION_ERROR');

    // 3. Check-in first -> 201
    await request(app.getHttpServer())
      .post('/api/v1/attendance/check-in')
      .send({ note: 'Morning arrival' })
      .expect(201);

    // 4. Check-out -> 200 OK
    const checkOutRes = await request(app.getHttpServer())
      .post('/api/v1/attendance/check-out')
      .send({ note: 'End of day' })
      .expect(200);
    expect(checkOutRes.body.success).toBe(true);
    expect(checkOutRes.body.message).toBe('Check-out recorded successfully');
    expect(checkOutRes.body.data.checkInAt).toBeTruthy();
    expect(checkOutRes.body.data.checkOutAt).toBeTruthy();
    expect(checkOutRes.body.data.note).toBe('End of day');

    // 5. Duplicate check-out -> 409 ALREADY_CHECKED_OUT
    const dupRes = await request(app.getHttpServer())
      .post('/api/v1/attendance/check-out')
      .send({})
      .expect(409);
    expect(dupRes.body.success).toBe(false);
    expect(dupRes.body.error.code).toBe('ALREADY_CHECKED_OUT');

    // 6. Verify /attendance/me reflects checkOutAt
    const boardRes = await request(app.getHttpServer())
      .get('/api/v1/attendance/me')
      .expect(200);
    expect(boardRes.body.data.today.checkOutAt).toBe(checkOutRes.body.data.checkOutAt);
  });
});
