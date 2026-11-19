import { Injectable } from '@nestjs/common';
import type { StoredAttendanceRow } from '../attendance/absence.query.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  RawEmployeeDashboardProfile,
  RawNotificationRow,
  RawTaskAssignmentRow,
} from './metrics/employee.metrics.js';

@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findEmployeeProfileByUserId(
    organizationId: string,
    userId: string,
  ): Promise<RawEmployeeDashboardProfile | null> {
    const employee = await this.prisma.employee.findFirst({
      where: {
        organizationId,
        userId,
      },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        workEmail: true,
        employmentStatus: true,
        joiningDate: true,
        exitDate: true,
        department: {
          select: { name: true },
        },
        designation: {
          select: { title: true },
        },
        organization: {
          select: {
            timezone: true,
            settings: true,
          },
        },
        teamMemberships: {
          where: { removedAt: null },
          select: {
            team: {
              select: { name: true, archivedAt: true },
            },
          },
        },
      },
    });

    if (!employee) {
      return null;
    }

    const teamNames = employee.teamMemberships
      .filter((m) => m.team.archivedAt === null)
      .map((m) => m.team.name);

    return {
      id: employee.id,
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
      workEmail: employee.workEmail,
      employmentStatus: employee.employmentStatus,
      joiningDate: employee.joiningDate,
      exitDate: employee.exitDate,
      departmentName: employee.department.name,
      designationTitle: employee.designation.title,
      teamNames,
      timezone: employee.organization.timezone,
      settings: employee.organization.settings,
    };
  }

  async findHolidayDates(
    organizationId: string,
    fromIso: string,
    toIso: string,
  ): Promise<Date[]> {
    const rows = await this.prisma.holiday.findMany({
      where: {
        organizationId,
        holidayDate: {
          gte: new Date(`${fromIso}T00:00:00Z`),
          lte: new Date(`${toIso}T00:00:00Z`),
        },
      },
      select: { holidayDate: true },
    });

    return rows.map((r) => r.holidayDate);
  }

  async findAttendanceInRange(
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

  async findTaskAssignments(
    organizationId: string,
    employeeId: string,
  ): Promise<RawTaskAssignmentRow[]> {
    const rows = await this.prisma.taskAssignment.findMany({
      where: {
        organizationId,
        employeeId,
        status: { not: 'cancelled' },
        task: { status: 'active' },
      },
      orderBy: [
        { task: { dueDate: 'asc' } },
        { createdAt: 'desc' },
      ],
      select: {
        id: true,
        taskId: true,
        status: true,
        task: {
          select: {
            title: true,
            priority: true,
            assignmentType: true,
            dueDate: true,
            team: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      taskId: row.taskId,
      status: row.status,
      title: row.task.title,
      priority: row.task.priority,
      assignmentType: row.task.assignmentType,
      dueDate: row.task.dueDate,
      teamName: row.task.team?.name ?? null,
      departmentName: row.task.department.name,
    }));
  }

  async countOpenFeedbackByUser(
    organizationId: string,
    userId: string,
  ): Promise<number> {
    return this.prisma.feedbackItem.count({
      where: {
        organizationId,
        submittedBy: userId,
        status: { in: ['open', 'in_review'] },
      },
    });
  }

  async findRecentNotifications(
    organizationId: string,
    userId: string,
    limit = 6,
  ): Promise<RawNotificationRow[]> {
    return this.prisma.notification.findMany({
      where: {
        organizationId,
        userId,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        readAt: true,
        createdAt: true,
      },
    });
  }
}
