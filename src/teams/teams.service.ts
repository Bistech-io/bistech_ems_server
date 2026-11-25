import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { isDepartmentHeadRole } from '../auth/role.utils.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  AddTeamMembersDto,
  CreateTeamDto,
  ListTeamsQueryDto,
  UpdateTeamDto,
} from './dto/team.dto.js';

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getCallerContext(organizationId: string, userId: string) {
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
      employeeId: employee?.id ?? null,
      headedDepartmentIds: employee?.departmentsHeaded.map((d) => d.id) ?? [],
    };
  }

  private assertCanManageTeams(caller: AuthenticatedUser) {
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isDeptHead = isDepartmentHeadRole(caller.roles);
    if (!isSuperAdmin && !isDeptHead) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only Super Admins or Department Heads can manage teams',
      });
    }
    return { isSuperAdmin, isDeptHead };
  }

  async listTeams(caller: AuthenticatedUser, query: ListTeamsQueryDto) {
    const orgId = caller.organizationId;
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isDeptHead = isDepartmentHeadRole(caller.roles);
    const ctx = await this.getCallerContext(orgId, caller.userId);

    const where: Record<string, unknown> = {
      organizationId: orgId,
      archivedAt: null,
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    };

    if (!isSuperAdmin) {
      if (isDeptHead && ctx.headedDepartmentIds.length > 0) {
        where.OR = [
          { departmentId: { in: ctx.headedDepartmentIds } },
          ...(ctx.employeeId
            ? [{ members: { some: { employeeId: ctx.employeeId, removedAt: null } } }]
            : []),
        ];
      } else if (ctx.employeeId) {
        where.members = { some: { employeeId: ctx.employeeId, removedAt: null } };
      } else {
        return {
          items: [],
          meta: { page: query.page, limit: query.limit, total: 0, totalPages: 0 },
        };
      }
    }

    const skip = (query.page - 1) * query.limit;
    const [total, teams] = await Promise.all([
      this.prisma.team.count({ where }),
      this.prisma.team.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { name: 'asc' },
        include: {
          department: { select: { id: true, name: true } },
          _count: {
            select: { members: { where: { removedAt: null } } },
          },
        },
      }),
    ]);

    return {
      items: teams.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        department: t.department,
        memberCount: t._count.members,
        createdAt: t.createdAt.toISOString(),
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async createTeam(dto: CreateTeamDto, caller: AuthenticatedUser) {
    const { isSuperAdmin } = this.assertCanManageTeams(caller);
    const orgId = caller.organizationId;
    const ctx = await this.getCallerContext(orgId, caller.userId);

    if (!isSuperAdmin && !ctx.headedDepartmentIds.includes(dto.departmentId)) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Department not found',
      });
    }

    const department = await this.prisma.department.findFirst({
      where: { id: dto.departmentId, organizationId: orgId, archivedAt: null },
      select: { id: true, name: true },
    });
    if (!department) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Department not found',
      });
    }

    const uniqueMemberIds = Array.from(new Set(dto.memberIds));
    let memberUsers: { id: string; userId: string }[] = [];

    if (uniqueMemberIds.length > 0) {
      const employees = await this.prisma.employee.findMany({
        where: {
          organizationId: orgId,
          id: { in: uniqueMemberIds },
        },
        select: {
          id: true,
          userId: true,
          departmentId: true,
          employmentStatus: true,
        },
      });

      if (employees.length !== uniqueMemberIds.length) {
        throw new UnprocessableEntityException({
          code: 'INVALID_TEAM_MEMBERS',
          message: 'One or more employees were not found',
        });
      }

      const invalidMember = employees.find(
        (e) => e.employmentStatus !== 'active' || e.departmentId !== dto.departmentId,
      );
      if (invalidMember) {
        throw new UnprocessableEntityException({
          code: 'INVALID_TEAM_MEMBERS',
          message: 'All team members must be active employees of the target department',
        });
      }

      memberUsers = employees.map((e) => ({ id: e.id, userId: e.userId }));
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const team = await tx.team.create({
          data: {
            organizationId: orgId,
            departmentId: dto.departmentId,
            name: dto.name,
            description: dto.description ?? null,
            createdBy: caller.userId,
          },
          include: {
            department: { select: { id: true, name: true } },
          },
        });

        if (memberUsers.length > 0) {
          await tx.teamMember.createMany({
            data: memberUsers.map((m) => ({
              organizationId: orgId,
              teamId: team.id,
              employeeId: m.id,
              addedBy: caller.userId,
            })),
          });

          const notifyTargets = memberUsers.filter((m) => m.userId !== caller.userId);
          if (notifyTargets.length > 0) {
            await tx.notification.createMany({
              data: notifyTargets.map((m) => ({
                organizationId: orgId,
                userId: m.userId,
                type: 'team.member.added',
                title: `Added to team: ${team.name}`,
                body: `Department: ${team.department.name}`,
                payload: { teamId: team.id },
                dedupeKey: `team.member.added:${team.id}:${m.userId}`,
              })),
            });
          }
        }

        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            actorUserId: caller.userId,
            action: 'team.created',
            entityType: 'team',
            entityId: team.id,
            metadata: {
              departmentId: dto.departmentId,
              memberCount: memberUsers.length,
            },
          },
        });

        return {
          id: team.id,
          name: team.name,
          description: team.description,
          department: team.department,
          memberCount: memberUsers.length,
          createdAt: team.createdAt.toISOString(),
        };
      });
    } catch (error: unknown) {
      const prismaCode =
        typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code?: string }).code
          : undefined;
      if (prismaCode === 'P2002') {
        throw new ConflictException({
          code: 'DUPLICATE_TEAM_NAME',
          message: 'An active team with this name already exists in the department',
        });
      }
      throw error;
    }
  }

  async getTeamById(teamId: string, caller: AuthenticatedUser) {
    const orgId = caller.organizationId;
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isDeptHead = isDepartmentHeadRole(caller.roles);
    const ctx = await this.getCallerContext(orgId, caller.userId);

    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId: orgId, archivedAt: null },
      include: {
        department: { select: { id: true, name: true } },
        members: {
          where: { removedAt: null },
          include: {
            employee: {
              select: {
                id: true,
                employeeCode: true,
                firstName: true,
                lastName: true,
                designation: { select: { title: true } },
              },
            },
          },
        },
      },
    });

    if (!team) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Team not found' });
    }

    const isMember =
      ctx.employeeId !== null && team.members.some((m) => m.employeeId === ctx.employeeId);
    const isManagedHead = isDeptHead && ctx.headedDepartmentIds.includes(team.departmentId);

    if (!isSuperAdmin && !isManagedHead && !isMember) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Team not found' });
    }

    return {
      id: team.id,
      name: team.name,
      description: team.description,
      department: team.department,
      members: team.members.map((m) => ({
        employeeId: m.employee.id,
        employeeCode: m.employee.employeeCode,
        fullName: `${m.employee.firstName} ${m.employee.lastName}`.trim(),
        designation: m.employee.designation.title,
        addedAt: m.addedAt.toISOString(),
      })),
      createdAt: team.createdAt.toISOString(),
    };
  }

  async updateTeam(teamId: string, dto: UpdateTeamDto, caller: AuthenticatedUser) {
    const { isSuperAdmin } = this.assertCanManageTeams(caller);
    const orgId = caller.organizationId;
    const ctx = await this.getCallerContext(orgId, caller.userId);

    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId: orgId, archivedAt: null },
      select: { id: true, departmentId: true },
    });
    if (!team || (!isSuperAdmin && !ctx.headedDepartmentIds.includes(team.departmentId))) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Team not found' });
    }

    const updated = await this.prisma.team.update({
      where: { organizationId_id: { organizationId: orgId, id: teamId } },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
      include: { department: { select: { id: true, name: true } } },
    });

    return {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      department: updated.department,
    };
  }

  async archiveTeam(teamId: string, caller: AuthenticatedUser) {
    const { isSuperAdmin } = this.assertCanManageTeams(caller);
    const orgId = caller.organizationId;
    const ctx = await this.getCallerContext(orgId, caller.userId);

    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId: orgId, archivedAt: null },
      select: { id: true, departmentId: true },
    });
    if (!team || (!isSuperAdmin && !ctx.headedDepartmentIds.includes(team.departmentId))) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Team not found' });
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.team.update({
        where: { organizationId_id: { organizationId: orgId, id: teamId } },
        data: { archivedAt: now },
      });
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: 'team.archived',
          entityType: 'team',
          entityId: teamId,
          metadata: {},
        },
      });
    });

    return { id: teamId, archivedAt: now.toISOString() };
  }

  async addTeamMembers(
    teamId: string,
    dto: AddTeamMembersDto,
    caller: AuthenticatedUser,
  ) {
    const { isSuperAdmin } = this.assertCanManageTeams(caller);
    const orgId = caller.organizationId;
    const ctx = await this.getCallerContext(orgId, caller.userId);

    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId: orgId, archivedAt: null },
      include: {
        department: { select: { name: true } },
        members: { where: { removedAt: null }, select: { employeeId: true } },
      },
    });
    if (!team || (!isSuperAdmin && !ctx.headedDepartmentIds.includes(team.departmentId))) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Team not found' });
    }

    const existingIds = new Set(team.members.map((m) => m.employeeId));
    const toAddIds = Array.from(new Set(dto.employeeIds)).filter((id) => !existingIds.has(id));

    if (existingIds.size + toAddIds.length > 50) {
      throw new UnprocessableEntityException({
        code: 'TEAM_MEMBER_LIMIT',
        message: 'A team cannot have more than 50 active members',
      });
    }

    if (toAddIds.length === 0) {
      return { teamId, addedCount: 0 };
    }

    const employees = await this.prisma.employee.findMany({
      where: { organizationId: orgId, id: { in: toAddIds } },
      select: { id: true, userId: true, departmentId: true, employmentStatus: true },
    });

    if (
      employees.length !== toAddIds.length ||
      employees.some((e) => e.employmentStatus !== 'active' || e.departmentId !== team.departmentId)
    ) {
      throw new UnprocessableEntityException({
        code: 'INVALID_TEAM_MEMBERS',
        message: 'All team members must be active employees of the team department',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.teamMember.createMany({
        data: employees.map((e) => ({
          organizationId: orgId,
          teamId,
          employeeId: e.id,
          addedBy: caller.userId,
        })),
      });

      const notifyTargets = employees.filter((e) => e.userId !== caller.userId);
      if (notifyTargets.length > 0) {
        await tx.notification.createMany({
          data: notifyTargets.map((e) => ({
            organizationId: orgId,
            userId: e.userId,
            type: 'team.member.added',
            title: `Added to team: ${team.name}`,
            body: `Department: ${team.department.name}`,
            payload: { teamId },
            dedupeKey: `team.member.added:${teamId}:${e.userId}:${Date.now()}`,
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: 'team.members.added',
          entityType: 'team',
          entityId: teamId,
          metadata: { addedEmployeeIds: toAddIds },
        },
      });
    });

    return { teamId, addedCount: toAddIds.length };
  }

  async removeTeamMember(
    teamId: string,
    employeeId: string,
    caller: AuthenticatedUser,
  ) {
    const { isSuperAdmin } = this.assertCanManageTeams(caller);
    const orgId = caller.organizationId;
    const ctx = await this.getCallerContext(orgId, caller.userId);

    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId: orgId, archivedAt: null },
      select: { id: true, departmentId: true },
    });
    if (!team || (!isSuperAdmin && !ctx.headedDepartmentIds.includes(team.departmentId))) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Team not found' });
    }

    const res = await this.prisma.teamMember.updateMany({
      where: {
        organizationId: orgId,
        teamId,
        employeeId,
        removedAt: null,
      },
      data: { removedAt: new Date() },
    });

    if (res.count === 0) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Active team membership not found',
      });
    }

    return { teamId, employeeId, removed: true };
  }
}
