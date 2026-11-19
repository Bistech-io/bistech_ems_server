import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  buildAttendanceBoard,
  evaluateCheckInPunctuality,
  getMonthStartIso,
  getOrgZonedParts,
  normalizeOrgSettings,
  toIsoDateString,
} from './absence.query.js';
import { AttendanceRepository } from './attendance.repository.js';
import type {
  AttendanceBoardResponseDto,
  AttendanceRecordDto,
} from './dto/attendance-board.response.dto.js';
import type { AttendanceMeQueryDto } from './dto/attendance-me-query.dto.js';
import type { CheckInDto } from './dto/check-in.dto.js';

@Injectable()
export class AttendanceService {
  constructor(private readonly attendanceRepo: AttendanceRepository) {}

  async checkIn(
    organizationId: string,
    userId: string,
    dto: CheckInDto,
    now: Date = new Date(),
  ): Promise<AttendanceRecordDto> {
    const context = await this.attendanceRepo.findEmployeeContextByUserId(
      organizationId,
      userId,
    );
    if (!context) {
      throw new NotFoundException({
        code: 'EMPLOYEE_NOT_FOUND',
        message: 'Employee record not found for current user',
      });
    }
    if (context.employmentStatus !== 'active') {
      throw new ForbiddenException({
        code: 'EMPLOYEE_INACTIVE',
        message: 'Inactive employees cannot check in',
      });
    }

    const settings = normalizeOrgSettings(context.settings);
    const { workDate, status, lateMinutes } = evaluateCheckInPunctuality(
      now,
      context.timezone,
      settings,
    );

    const existing = await this.attendanceRepo.findRecordByDate(
      organizationId,
      context.employeeId,
      workDate,
    );
    if (existing) {
      throw new ConflictException({
        code: 'ALREADY_CHECKED_IN',
        message: `Attendance already recorded for ${workDate}`,
      });
    }

    try {
      const created = await this.attendanceRepo.createWebCheckIn({
        organizationId,
        employeeId: context.employeeId,
        workDateIso: workDate,
        checkInAt: now,
        status,
        lateMinutes,
        note: dto.note,
      });

      return {
        id: created.id,
        workDate: toIsoDateString(created.workDate),
        checkInAt: created.checkInAt ? created.checkInAt.toISOString() : null,
        status: created.status,
        source: created.source,
        lateMinutes: created.lateMinutes,
        note: created.note,
        isDerived: false,
      };
    } catch (error: unknown) {
      const prismaCode =
        typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code?: string }).code
          : undefined;

      if (prismaCode === 'P2002') {
        throw new ConflictException({
          code: 'ALREADY_CHECKED_IN',
          message: `Attendance already recorded for ${workDate}`,
        });
      }
      throw error;
    }
  }

  async getMyAttendanceBoard(
    organizationId: string,
    userId: string,
    query: AttendanceMeQueryDto,
    now: Date = new Date(),
  ): Promise<AttendanceBoardResponseDto> {
    const context = await this.attendanceRepo.findEmployeeContextByUserId(
      organizationId,
      userId,
    );
    if (!context) {
      throw new NotFoundException({
        code: 'EMPLOYEE_NOT_FOUND',
        message: 'Employee record not found for current user',
      });
    }

    const settings = normalizeOrgSettings(context.settings);
    const { dateStr: todayDateStr } = getOrgZonedParts(now, context.timezone);

    const from = query.from ?? getMonthStartIso(todayDateStr);
    const to = query.to ?? todayDateStr;

    const [holidays, storedRows, todayStoredRow] = await Promise.all([
      this.attendanceRepo.findHolidayDates(organizationId, from, to),
      this.attendanceRepo.findRecordsInRange(
        organizationId,
        context.employeeId,
        from,
        to,
      ),
      this.attendanceRepo.findRecordByDate(
        organizationId,
        context.employeeId,
        todayDateStr,
      ),
    ]);

    const holidayDates = new Set(holidays.map(toIsoDateString));
    const board = buildAttendanceBoard({
      now,
      timezone: context.timezone,
      settings,
      from,
      to,
      joiningDate: toIsoDateString(context.joiningDate),
      exitDate: context.exitDate ? toIsoDateString(context.exitDate) : null,
      isEmployeeActive: context.employmentStatus === 'active',
      holidayDates,
      storedRows,
      todayStoredRow,
    });

    return {
      timezone: context.timezone,
      workStart: settings.workStart,
      graceMinutes: settings.graceMinutes,
      workEnd: settings.workEnd,
      from,
      to,
      today: board.today,
      summary: board.summary,
      records: board.records,
    };
  }
}
