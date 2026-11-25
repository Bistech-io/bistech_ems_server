import { Injectable } from '@nestjs/common';
import type { StoredAttendanceRow } from '../attendance/absence.query.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  RawEmployeeDashboardProfile,
  RawNotificationRow,
  RawTaskAssignmentRow,
} from './metrics/employee.metrics.js';
import type {
  RawHrEmployeeRow,
  RawOrgAuditLogRow,
  RawOrgDepartmentRow,
  RawOrgTaskAssignmentRow,
} from './metrics/hr.metrics.js';

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

  async findOrganizationConfig(
    organizationId: string,
  ): Promise<{ timezone: string; settings: unknown } | null> {
    return this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true, settings: true },
    });
  }

  async findOrgDepartments(organizationId: string): Promise<RawOrgDepartmentRow[]> {
    return this.prisma.department.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  async findOrgEmployeesForHrDashboard(
    organizationId: string,
  ): Promise<RawHrEmployeeRow[]> {
    const rows = await this.prisma.employee.findMany({
      where: { organizationId },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        employmentStatus: true,
        joiningDate: true,
        exitDate: true,
        departmentId: true,
        department: { select: { name: true } },
        designation: { select: { title: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      employeeCode: r.employeeCode,
      firstName: r.firstName,
      lastName: r.lastName,
      employmentStatus: r.employmentStatus,
      joiningDate: r.joiningDate,
      exitDate: r.exitDate,
      departmentId: r.departmentId,
      departmentName: r.department.name,
      designationTitle: r.designation.title,
    }));
  }

  async findOrgAttendanceInRange(
    organizationId: string,
    fromIso: string,
    toIso: string,
  ): Promise<(StoredAttendanceRow & { employeeId: string })[]> {
    return this.prisma.attendanceRecord.findMany({
      where: {
        organizationId,
        workDate: {
          gte: new Date(`${fromIso}T00:00:00Z`),
          lte: new Date(`${toIso}T00:00:00Z`),
        },
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

  async findOrgFirstCheckInDates(
    organizationId: string,
  ): Promise<Map<string, Date>> {
    const groups = await this.prisma.attendanceRecord.groupBy({
      by: ['employeeId'],
      where: {
        organizationId,
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

  async findOrgTaskAssignments(
    organizationId: string,
  ): Promise<RawOrgTaskAssignmentRow[]> {
    const rows = await this.prisma.taskAssignment.findMany({
      where: {
        organizationId,
        status: { not: 'cancelled' },
        task: { status: 'active' },
      },
      select: {
        status: true,
        task: { select: { dueDate: true } },
      },
    });

    return rows.map((r) => ({
      status: r.status,
      dueDate: r.task.dueDate,
    }));
  }

  async countOrgOpenFeedback(organizationId: string): Promise<number> {
    return this.prisma.feedbackItem.count({
      where: {
        organizationId,
        status: { in: ['open', 'in_review'] },
      },
    });
  }

  async findRecentOrgAuditLogs(
    organizationId: string,
    limit = 6,
  ): Promise<RawOrgAuditLogRow[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        actor: { select: { displayName: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actorName: r.actor?.displayName ?? null,
      createdAt: r.createdAt,
    }));
  }

  async countActiveTeams(organizationId: string): Promise<number> {
    return this.prisma.team.count({
      where: { organizationId, archivedAt: null },
    });
  }

  async countDepartmentsWithHead(organizationId: string): Promise<number> {
    return this.prisma.department.count({
      where: {
        organizationId,
        archivedAt: null,
        headEmployeeId: { not: null },
      },
    });
  }

  async countPendingReviewsExcludingUser(
    organizationId: string,
    userId: string,
  ): Promise<number> {
    return this.prisma.taskSubmission.count({
      where: {
        organizationId,
        reviewStatus: 'pending',
        submittedBy: { not: userId },
      },
    });
  }

  async countOrgOpenFeedbackByKind(
    organizationId: string,
  ): Promise<{ issues: number; suggestions: number }> {
    const [issues, suggestions] = await Promise.all([
      this.prisma.feedbackItem.count({
        where: {
          organizationId,
          kind: 'issue',
          status: { in: ['open', 'in_review'] },
        },
      }),
      this.prisma.feedbackItem.count({
        where: {
          organizationId,
          kind: 'suggestion',
          status: { in: ['open', 'in_review'] },
        },
      }),
    ]);

    return { issues, suggestions };
  }
}
