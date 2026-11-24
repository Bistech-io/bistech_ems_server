import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { StoredAttendanceRow } from './absence.query.js';

export interface EmployeeAttendanceContext {
  organizationId: string;
  timezone: string;
  settings: unknown;
  employeeId: string;
  employmentStatus: 'active' | 'inactive';
  joiningDate: Date;
  exitDate: Date | null;
}

export interface ScopedEmployeeRow {
  id: string;
  userId: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  employmentStatus: 'active' | 'inactive';
  joiningDate: Date;
  exitDate: Date | null;
  department: { id: string; name: string };
  designation: { id: string; title: string };
}

export interface StoredAttendanceWithEmployee extends StoredAttendanceRow {
  employeeId: string;
  employee: {
    id: string;
    userId: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    department: { id: string; name: string };
    designation: { id: string; title: string };
  };
}

@Injectable()
export class AttendanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findEmployeeContextByUserId(
    organizationId: string,
    userId: string,
  ): Promise<EmployeeAttendanceContext | null> {
    const employee = await this.prisma.employee.findFirst({
      where: {
        userId,
        organizationId,
      },
      select: {
        id: true,
        organizationId: true,
        employmentStatus: true,
        joiningDate: true,
        exitDate: true,
        organization: {
          select: {
            timezone: true,
            settings: true,
          },
        },
      },
    });

    if (!employee) {
      return null;
    }

    return {
      organizationId: employee.organizationId,
      timezone: employee.organization.timezone,
      settings: employee.organization.settings,
      employeeId: employee.id,
      employmentStatus: employee.employmentStatus,
      joiningDate: employee.joiningDate,
      exitDate: employee.exitDate,
    };
  }

  async findHolidayDates(
    organizationId: string,
    fromIso: string,
    toIso: string,
  ): Promise<Date[]> {
    const holidays = await this.prisma.holiday.findMany({
      where: {
        organizationId,
        holidayDate: {
          gte: new Date(`${fromIso}T00:00:00Z`),
          lte: new Date(`${toIso}T00:00:00Z`),
        },
      },
      select: { holidayDate: true },
    });

    return holidays.map((h) => h.holidayDate);
  }

  async findRecordsInRange(
    organizationId: string,
    employeeId: string,
    fromIso: string,
    toIso: string,
  ): Promise<StoredAttendanceRow[]> {
    return this.prisma.attendanceRecord.findMany({
      where: {
        organizationId,
        employeeId,
        workDate: {
          gte: new Date(`${fromIso}T00:00:00Z`),
          lte: new Date(`${toIso}T00:00:00Z`),
        },
      },
      orderBy: { workDate: 'asc' },
      select: {
        id: true,
        workDate: true,
        checkInAt: true,
        status: true,
        source: true,
        lateMinutes: true,
        note: true,
      },
    });
  }

  async findRecordByDate(
    organizationId: string,
    employeeId: string,
    workDateIso: string,
  ): Promise<StoredAttendanceRow | null> {
    return this.prisma.attendanceRecord.findFirst({
      where: {
        organizationId,
        employeeId,
        workDate: new Date(`${workDateIso}T00:00:00Z`),
      },
      select: {
        id: true,
        workDate: true,
        checkInAt: true,
        status: true,
        source: true,
        lateMinutes: true,
        note: true,
      },
    });
  }

  async createWebCheckIn(input: {
    organizationId: string;
    employeeId: string;
    workDateIso: string;
    checkInAt: Date;
    status: 'present' | 'late';
    lateMinutes: number;
    note?: string;
  }): Promise<StoredAttendanceRow> {
    return this.prisma.attendanceRecord.create({
      data: {
        organizationId: input.organizationId,
        employeeId: input.employeeId,
        workDate: new Date(`${input.workDateIso}T00:00:00Z`),
        checkInAt: input.checkInAt,
        status: input.status,
        source: 'web',
        lateMinutes: input.lateMinutes,
        note: input.note ?? null,
      },
      select: {
        id: true,
        workDate: true,
        checkInAt: true,
        status: true,
        source: true,
        lateMinutes: true,
        note: true,
      },
    });
  }

  async findOrganizationConfig(
    organizationId: string,
  ): Promise<{ timezone: string; settings: unknown } | null> {
    return this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true, settings: true },
    });
  }

  async findHeadedDepartmentIds(
    organizationId: string,
    userId: string,
  ): Promise<{ ownEmployeeId: string | null; headedDepartmentIds: string[] }> {
    const employee = await this.prisma.employee.findFirst({
      where: { organizationId, userId },
      select: {
        id: true,
        departmentsHeaded: {
          where: { organizationId, archivedAt: null },
          select: { id: true },
        },
      },
    });

    return {
      ownEmployeeId: employee?.id ?? null,
      headedDepartmentIds: employee?.departmentsHeaded.map((d) => d.id) ?? [],
    };
  }

  async findScopedEmployeesForAttendance(
    organizationId: string,
    filter: {
      employeeId?: string;
      departmentId?: string;
      allowedDepartmentIds?: string[];
      ownEmployeeId?: string;
    },
  ): Promise<ScopedEmployeeRow[]> {
    const scopeClauses: Record<string, unknown>[] = [];
    if (filter.allowedDepartmentIds && filter.ownEmployeeId) {
      scopeClauses.push({
        OR: [
          { departmentId: { in: filter.allowedDepartmentIds } },
          { id: filter.ownEmployeeId },
        ],
      });
    } else if (filter.ownEmployeeId) {
      scopeClauses.push({ id: filter.ownEmployeeId });
    }

    return this.prisma.employee.findMany({
      where: {
        organizationId,
        ...(filter.employeeId ? { id: filter.employeeId } : {}),
        ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
        ...(scopeClauses.length > 0 ? { AND: scopeClauses } : {}),
      },
      orderBy: [{ employeeCode: 'asc' }],
      select: {
        id: true,
        userId: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        employmentStatus: true,
        joiningDate: true,
        exitDate: true,
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, title: true } },
      },
    });
  }

  async findRecordsInRangeForEmployees(
    organizationId: string,
    employeeIds: string[],
    fromIso: string,
    toIso: string,
  ): Promise<(StoredAttendanceRow & { employeeId: string })[]> {
    if (employeeIds.length === 0) {
      return [];
    }

    return this.prisma.attendanceRecord.findMany({
      where: {
        organizationId,
        employeeId: { in: employeeIds },
        workDate: {
          gte: new Date(`${fromIso}T00:00:00Z`),
          lte: new Date(`${toIso}T00:00:00Z`),
        },
      },
      orderBy: [{ workDate: 'desc' }],
      select: {
        id: true,
        employeeId: true,
        workDate: true,
        checkInAt: true,
        status: true,
        source: true,
        lateMinutes: true,
        note: true,
      },
    });
  }

  async findFirstCheckInDate(
    organizationId: string,
    employeeId: string,
  ): Promise<Date | null> {
    const row = await this.prisma.attendanceRecord.findFirst({
      where: {
        organizationId,
        employeeId,
        OR: [
          { checkInAt: { not: null } },
          { status: { in: ['present', 'late'] } },
        ],
      },
      orderBy: { workDate: 'asc' },
      select: { workDate: true },
    });

    return row?.workDate ?? null;
  }

  async findFirstCheckInDatesForEmployees(
    organizationId: string,
    employeeIds: string[],
  ): Promise<Map<string, Date>> {
    if (employeeIds.length === 0) {
      return new Map();
    }

    const groups = await this.prisma.attendanceRecord.groupBy({
      by: ['employeeId'],
      where: {
        organizationId,
        employeeId: { in: employeeIds },
        OR: [
          { checkInAt: { not: null } },
          { status: { in: ['present', 'late'] } },
        ],
      },
      _min: { workDate: true },
    });

    const map = new Map<string, Date>();
    for (const group of groups) {
      if (group._min.workDate) {
        map.set(group.employeeId, group._min.workDate);
      }
    }
    return map;
  }

  async findStoredRecordById(
    organizationId: string,
    recordId: string,
  ): Promise<StoredAttendanceWithEmployee | null> {
    return this.prisma.attendanceRecord.findFirst({
      where: {
        organizationId,
        id: recordId,
      },
      select: {
        id: true,
        employeeId: true,
        workDate: true,
        checkInAt: true,
        status: true,
        source: true,
        lateMinutes: true,
        note: true,
        employee: {
          select: {
            id: true,
            userId: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            department: { select: { id: true, name: true } },
            designation: { select: { id: true, title: true } },
          },
        },
      },
    });
  }
}
