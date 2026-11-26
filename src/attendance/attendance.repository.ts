import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { StoredAttendanceRow } from './absence.query.js';

export interface EmployeeAttendanceContext {
  organizationId: string;
  timezone: string;
  settings: unknown;
  allowedOfficeIps: string[];
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

const BASE_RECORD_SELECT = {
  id: true,
  workDate: true,
  checkInAt: true,
  status: true,
  source: true,
  lateMinutes: true,
  note: true,
} as const;

const FULL_RECORD_SELECT = {
  ...BASE_RECORD_SELECT,
  checkOutAt: true,
} as const;

function isMissingAttendanceSecurityColumnError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const record = err as { code?: unknown; message?: unknown };
  if (record.code === 'P2022') return true;
  if (typeof record.message !== 'string') return false;
  return (
    record.message.includes('check_out_at') ||
    record.message.includes('check_in_ip') ||
    record.message.includes('check_out_ip') ||
    record.message.includes('allowed_office_ips')
  );
}

@Injectable()
export class AttendanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureAttendanceSecurityColumns(): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      'ALTER TABLE "attendance_records" ADD COLUMN IF NOT EXISTS "check_out_at" TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS "check_in_ip" TEXT, ADD COLUMN IF NOT EXISTS "check_out_ip" TEXT',
    );
  }

  async findEmployeeContextByUserId(
    organizationId: string,
    userId: string,
  ): Promise<EmployeeAttendanceContext | null> {
    let employee: {
      id: string;
      organizationId: string;
      employmentStatus: 'active' | 'inactive';
      joiningDate: Date;
      exitDate: Date | null;
      organization: {
        timezone: string;
        settings: unknown;
        allowedOfficeIps?: string[];
      };
    } | null;

    try {
      employee = await this.prisma.employee.findFirst({
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
              allowedOfficeIps: true,
            },
          },
        },
      });
    } catch (err) {
      if (!isMissingAttendanceSecurityColumnError(err)) throw err;
      employee = await this.prisma.employee.findFirst({
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
    }

    if (!employee) {
      return null;
    }

    return {
      organizationId: employee.organizationId,
      timezone: employee.organization.timezone,
      settings: employee.organization.settings,
      allowedOfficeIps: Array.isArray(employee.organization.allowedOfficeIps)
        ? employee.organization.allowedOfficeIps
        : [],
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
    const where = {
      organizationId,
      employeeId,
      workDate: {
        gte: new Date(`${fromIso}T00:00:00Z`),
        lte: new Date(`${toIso}T00:00:00Z`),
      },
    };
    try {
      return await this.prisma.attendanceRecord.findMany({
        where,
        orderBy: { workDate: 'asc' },
        select: FULL_RECORD_SELECT,
      });
    } catch (err) {
      if (!isMissingAttendanceSecurityColumnError(err)) throw err;
      return this.prisma.attendanceRecord.findMany({
        where,
        orderBy: { workDate: 'asc' },
        select: BASE_RECORD_SELECT,
      });
    }
  }

  async findRecordByDate(
    organizationId: string,
    employeeId: string,
    workDateIso: string,
  ): Promise<StoredAttendanceRow | null> {
    const where = {
      organizationId,
      employeeId,
      workDate: new Date(`${workDateIso}T00:00:00Z`),
    };
    try {
      return await this.prisma.attendanceRecord.findFirst({
        where,
        select: FULL_RECORD_SELECT,
      });
    } catch (err) {
      if (!isMissingAttendanceSecurityColumnError(err)) throw err;
      return this.prisma.attendanceRecord.findFirst({
        where,
        select: BASE_RECORD_SELECT,
      });
    }
  }

  async createWebCheckIn(input: {
    organizationId: string;
    employeeId: string;
    workDateIso: string;
    checkInAt: Date;
    status: 'present' | 'late';
    lateMinutes: number;
    note?: string;
    checkInIp?: string | null;
  }): Promise<StoredAttendanceRow> {
    const baseData = {
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      workDate: new Date(`${input.workDateIso}T00:00:00Z`),
      checkInAt: input.checkInAt,
      status: input.status,
      source: 'web' as const,
      lateMinutes: input.lateMinutes,
      note: input.note ?? null,
    };
    const dataWithIp = {
      ...baseData,
      ...(input.checkInIp ? { checkInIp: input.checkInIp } : {}),
    };
    try {
      return await this.prisma.attendanceRecord.create({
        data: dataWithIp,
        select: FULL_RECORD_SELECT,
      });
    } catch (err) {
      if (!isMissingAttendanceSecurityColumnError(err)) throw err;
      return this.prisma.attendanceRecord.create({
        data: baseData,
        select: BASE_RECORD_SELECT,
      });
    }
  }

  async recordWebCheckOut(input: {
    id: string;
    checkOutAt: Date;
    note?: string;
    checkOutIp?: string | null;
  }): Promise<StoredAttendanceRow> {
    const data = {
      checkOutAt: input.checkOutAt,
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.checkOutIp ? { checkOutIp: input.checkOutIp } : {}),
    };
    try {
      return await this.prisma.attendanceRecord.update({
        where: { id: input.id },
        data,
        select: FULL_RECORD_SELECT,
      });
    } catch (err) {
      if (!isMissingAttendanceSecurityColumnError(err)) throw err;
      await this.ensureAttendanceSecurityColumns();
      return this.prisma.attendanceRecord.update({
        where: { id: input.id },
        data,
        select: FULL_RECORD_SELECT,
      });
    }
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
