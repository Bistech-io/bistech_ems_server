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
}
