import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { isDepartmentHeadRole } from '../auth/role.utils.js';
import {
  buildAttendanceBoard,
  evaluateCheckInPunctuality,
  getMonthStartIso,
  getOrgZonedParts,
  normalizeOrgSettings,
  toIsoDateString,
  type StoredAttendanceRow,
} from './absence.query.js';
import { AttendanceRepository } from './attendance.repository.js';
import type {
  AttendanceBoardResponseDto,
  AttendanceRecordDto,
} from './dto/attendance-board.response.dto.js';
import type {
  AttendanceListQueryDto,
  AttendanceSummaryBucketDto,
  AttendanceSummaryQueryDto,
  AttendanceSummaryResponseDto,
  HrAttendanceListItemDto,
} from './dto/attendance-list-query.dto.js';
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

    const [holidays, storedRows, todayStoredRow, firstCheckInDate] = await Promise.all([
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
      this.attendanceRepo.findFirstCheckInDate(organizationId, context.employeeId),
    ]);

    const holidayDates = new Set(holidays.map(toIsoDateString));
    const board = buildAttendanceBoard({
      now,
      timezone: context.timezone,
      settings,
      from,
      to,
      joiningDate: toIsoDateString(context.joiningDate),
      firstCheckInDate: firstCheckInDate ? toIsoDateString(firstCheckInDate) : null,
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

  private async resolveAttendanceScope(caller: AuthenticatedUser): Promise<{
    isOrgScope: boolean;
    allowedDepartmentIds?: string[];
    ownEmployeeId?: string;
  }> {
    if (
      caller.roles.includes('super_admin') ||
      caller.roles.includes('hr_manager')
    ) {
      return { isOrgScope: true };
    }

    const { ownEmployeeId, headedDepartmentIds } =
      await this.attendanceRepo.findHeadedDepartmentIds(
        caller.organizationId,
        caller.userId,
      );

    if (isDepartmentHeadRole(caller.roles) && headedDepartmentIds.length > 0) {
      return {
        isOrgScope: false,
        allowedDepartmentIds: headedDepartmentIds,
        ownEmployeeId: ownEmployeeId ?? undefined,
      };
    }

    return {
      isOrgScope: false,
      ownEmployeeId: ownEmployeeId ?? '00000000-0000-0000-0000-000000000000',
    };
  }

  async listAttendance(
    caller: AuthenticatedUser,
    query: AttendanceListQueryDto,
    now: Date = new Date(),
  ): Promise<{
    items: HrAttendanceListItemDto[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const org = await this.attendanceRepo.findOrganizationConfig(caller.organizationId);
    if (!org) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Organization not found',
      });
    }

    const settings = normalizeOrgSettings(org.settings);
    const { dateStr: todayDateStr } = getOrgZonedParts(now, org.timezone);
    const from = query.from ?? todayDateStr;
    const to = query.to ?? todayDateStr;

    const scope = await this.resolveAttendanceScope(caller);
    const employees = await this.attendanceRepo.findScopedEmployeesForAttendance(
      caller.organizationId,
      {
        employeeId: query.employeeId,
        departmentId: query.departmentId,
        allowedDepartmentIds: scope.allowedDepartmentIds,
        ownEmployeeId: scope.ownEmployeeId,
      },
    );

    if (employees.length === 0) {
      return {
        items: [],
        meta: { page: query.page, limit: query.limit, total: 0, totalPages: 0 },
      };
    }

    const employeeIds = employees.map((e) => e.id);
    const [holidays, storedRows, firstCheckInByEmployee] = await Promise.all([
      this.attendanceRepo.findHolidayDates(caller.organizationId, from, to),
      this.attendanceRepo.findRecordsInRangeForEmployees(
        caller.organizationId,
        employeeIds,
        from,
        to,
      ),
      this.attendanceRepo.findFirstCheckInDatesForEmployees(
        caller.organizationId,
        employeeIds,
      ),
    ]);

    const holidayDates = new Set(holidays.map(toIsoDateString));
    const rowsByEmployee = new Map<string, StoredAttendanceRow[]>();
    for (const row of storedRows) {
      const list = rowsByEmployee.get(row.employeeId) ?? [];
      list.push(row);
      rowsByEmployee.set(row.employeeId, list);
    }

    const allItems: HrAttendanceListItemDto[] = [];
    for (const emp of employees) {
      const empRows = rowsByEmployee.get(emp.id) ?? [];
      const todayStoredRow =
        empRows.find((r) => toIsoDateString(r.workDate) === todayDateStr) ?? null;
      const firstCheckIn = firstCheckInByEmployee.get(emp.id) ?? null;

      const board = buildAttendanceBoard({
        now,
        timezone: org.timezone,
        settings,
        from,
        to,
        joiningDate: toIsoDateString(emp.joiningDate),
        firstCheckInDate: firstCheckIn ? toIsoDateString(firstCheckIn) : null,
        exitDate: emp.exitDate ? toIsoDateString(emp.exitDate) : null,
        isEmployeeActive: emp.employmentStatus === 'active',
        holidayDates,
        storedRows: empRows,
        todayStoredRow,
      });

      for (const rec of board.records) {
        if (query.status && rec.status !== query.status) {
          continue;
        }
        allItems.push({
          ...rec,
          employee: {
            id: emp.id,
            employeeCode: emp.employeeCode,
            fullName: `${emp.firstName} ${emp.lastName}`.trim(),
            department: emp.department,
            designation: emp.designation,
          },
        });
      }
    }

    allItems.sort((a, b) => {
      if (a.workDate !== b.workDate) {
        return b.workDate.localeCompare(a.workDate);
      }
      return a.employee.employeeCode.localeCompare(b.employee.employeeCode);
    });

    const total = allItems.length;
    const totalPages = Math.ceil(total / query.limit);
    const start = (query.page - 1) * query.limit;
    const items = allItems.slice(start, start + query.limit);

    return {
      items,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
      },
    };
  }

  async getAttendanceSummary(
    caller: AuthenticatedUser,
    query: AttendanceSummaryQueryDto,
    now: Date = new Date(),
  ): Promise<AttendanceSummaryResponseDto> {
    const org = await this.attendanceRepo.findOrganizationConfig(caller.organizationId);
    if (!org) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Organization not found',
      });
    }

    const settings = normalizeOrgSettings(org.settings);
    const { dateStr: todayDateStr } = getOrgZonedParts(now, org.timezone);
    const from = query.from ?? getMonthStartIso(todayDateStr);
    const to = query.to ?? todayDateStr;

    const scope = await this.resolveAttendanceScope(caller);
    const employees = await this.attendanceRepo.findScopedEmployeesForAttendance(
      caller.organizationId,
      {
        employeeId: query.employeeId,
        departmentId: query.departmentId,
        allowedDepartmentIds: scope.allowedDepartmentIds,
        ownEmployeeId: scope.ownEmployeeId,
      },
    );

    const employeeIds = employees.map((e) => e.id);
    const [holidays, storedRows, firstCheckInByEmployee] = await Promise.all([
      this.attendanceRepo.findHolidayDates(caller.organizationId, from, to),
      this.attendanceRepo.findRecordsInRangeForEmployees(
        caller.organizationId,
        employeeIds,
        from,
        to,
      ),
      this.attendanceRepo.findFirstCheckInDatesForEmployees(
        caller.organizationId,
        employeeIds,
      ),
    ]);

    const holidayDates = new Set(holidays.map(toIsoDateString));
    const rowsByEmployee = new Map<string, StoredAttendanceRow[]>();
    for (const row of storedRows) {
      const list = rowsByEmployee.get(row.employeeId) ?? [];
      list.push(row);
      rowsByEmployee.set(row.employeeId, list);
    }

    const bucketMap = new Map<
      string,
      { presentCount: number; lateCount: number; absentCount: number; expectedCount: number }
    >();

    for (const emp of employees) {
      const empRows = rowsByEmployee.get(emp.id) ?? [];
      const todayStoredRow =
        empRows.find((r) => toIsoDateString(r.workDate) === todayDateStr) ?? null;
      const firstCheckIn = firstCheckInByEmployee.get(emp.id) ?? null;

      const board = buildAttendanceBoard({
        now,
        timezone: org.timezone,
        settings,
        from,
        to,
        joiningDate: toIsoDateString(emp.joiningDate),
        firstCheckInDate: firstCheckIn ? toIsoDateString(firstCheckIn) : null,
        exitDate: emp.exitDate ? toIsoDateString(emp.exitDate) : null,
        isEmployeeActive: emp.employmentStatus === 'active',
        holidayDates,
        storedRows: empRows,
        todayStoredRow,
      });

      for (const rec of board.records) {
        const period = query.groupBy === 'month' ? rec.workDate.slice(0, 7) : rec.workDate;
        const bucket = bucketMap.get(period) ?? {
          presentCount: 0,
          lateCount: 0,
          absentCount: 0,
          expectedCount: 0,
        };

        if (rec.status === 'present') bucket.presentCount += 1;
        else if (rec.status === 'late') bucket.lateCount += 1;
        else bucket.absentCount += 1;

        bucket.expectedCount += 1;
        bucketMap.set(period, bucket);
      }
    }

    let totalPresent = 0;
    let totalLate = 0;
    let totalAbsent = 0;
    let totalExpected = 0;

    const buckets: AttendanceSummaryBucketDto[] = Array.from(bucketMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, counts]) => {
        totalPresent += counts.presentCount;
        totalLate += counts.lateCount;
        totalAbsent += counts.absentCount;
        totalExpected += counts.expectedCount;

        const attended = counts.presentCount + counts.lateCount;
        return {
          period,
          ...counts,
          attendanceRatePercent:
            counts.expectedCount > 0
              ? Math.round((attended / counts.expectedCount) * 1000) / 10
              : 100,
        };
      });

    const totalAttended = totalPresent + totalLate;
    return {
      groupBy: query.groupBy,
      from,
      to,
      timezone: org.timezone,
      totals: {
        presentCount: totalPresent,
        lateCount: totalLate,
        absentCount: totalAbsent,
        expectedCount: totalExpected,
        attendanceRatePercent:
          totalExpected > 0 ? Math.round((totalAttended / totalExpected) * 1000) / 10 : 100,
      },
      buckets,
    };
  }

  async getAttendanceById(
    caller: AuthenticatedUser,
    recordId: string,
  ): Promise<HrAttendanceListItemDto> {
    const record = await this.attendanceRepo.findStoredRecordById(
      caller.organizationId,
      recordId,
    );
    if (!record) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Attendance record not found',
      });
    }

    const scope = await this.resolveAttendanceScope(caller);
    if (!scope.isOrgScope) {
      const isOwn = record.employeeId === scope.ownEmployeeId;
      const isManaged =
        scope.allowedDepartmentIds?.includes(record.employee.department.id) ?? false;

      if (!isOwn && !isManaged) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Attendance record not found',
        });
      }
    }

    return {
      id: record.id,
      workDate: toIsoDateString(record.workDate),
      checkInAt: record.checkInAt ? record.checkInAt.toISOString() : null,
      status: record.status,
      source: record.source,
      lateMinutes: record.lateMinutes,
      note: record.note,
      isDerived: false,
      employee: {
        id: record.employee.id,
        employeeCode: record.employee.employeeCode,
        fullName: `${record.employee.firstName} ${record.employee.lastName}`.trim(),
        department: record.employee.department,
        designation: record.employee.designation,
      },
    };
  }
}
