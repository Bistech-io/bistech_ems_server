import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import {
  DEPT_HEAD_ROLE_NAMES,
  isDepartmentHeadRole,
  isDepartmentHeadRoleName,
} from '../auth/role.utils.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import type { UpdateUserRolesDto } from './dto/update-user-roles.dto.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(caller: AuthenticatedUser, query: ListUsersQueryDto) {
    const isHrOrAdmin =
      caller.roles.includes('super_admin') || caller.roles.includes('hr_manager');

    if (!isHrOrAdmin) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only Super Admins or HR Managers can list users',
      });
    }

    const orgId = caller.organizationId;
    const where: Record<string, unknown> = {
      organizationId: orgId,
    };

    if (query.role) {
      where.userRoles = {
        some: {
          role: {
            name: isDepartmentHeadRoleName(query.role)
              ? { in: [...DEPT_HEAD_ROLE_NAMES] }
              : query.role,
          },
        },
      };
    }

    if (query.search) {
      where.OR = [
        { displayName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { username: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const skip = (query.page - 1) * query.limit;

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          email: true,
          displayName: true,
          accountStatus: true,
          lastLoginAt: true,
          createdAt: true,
          userRoles: {
            select: {
              role: { select: { id: true, name: true } },
            },
          },
          employee: {
            select: {
              id: true,
              employeeCode: true,
              employmentStatus: true,
              department: { select: { id: true, name: true } },
              designation: { select: { id: true, title: true } },
            },
          },
        },
      }),
    ]);

    return {
      items: users.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        displayName: u.displayName,
        accountStatus: u.accountStatus,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
        roles: u.userRoles.map((ur) => ur.role.name),
        employee: u.employee,
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async listRoles(caller: AuthenticatedUser) {
    const isHrOrAdmin =
      caller.roles.includes('super_admin') || caller.roles.includes('hr_manager');

    if (!isHrOrAdmin) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only Super Admins or HR Managers can view roles',
      });
    }

    return this.prisma.role.findMany({
      where: { organizationId: caller.organizationId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        isSystem: true,
        _count: {
          select: { userRoles: true },
        },
      },
    });
  }

  async updateUserRoles(
    targetUserId: string,
    dto: UpdateUserRolesDto,
    caller: AuthenticatedUser,
  ) {
    if (!caller.roles.includes('super_admin')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only Super Admins can assign or update user roles',
      });
    }

    if (targetUserId === caller.userId) {
      throw new ForbiddenException({
        code: 'SELF_MODIFICATION_NOT_ALLOWED',
        message: 'You cannot modify your own roles',
      });
    }

    const orgId = caller.organizationId;
    const requestedRoleNames = Array.from(new Set(dto.roles));

    return this.prisma.$transaction(async (tx) => {
      const targetUser = await tx.user.findUnique({
        where: {
          organizationId_id: {
            organizationId: orgId,
            id: targetUserId,
          },
        },
        select: {
          id: true,
          email: true,
          displayName: true,
          accountStatus: true,
          userRoles: {
            select: {
              role: { select: { id: true, name: true } },
            },
          },
        },
      });

      if (!targetUser) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'User not found in this organization',
        });
      }

      const previousRoles = targetUser.userRoles.map((ur) => ur.role.name);
      const hadSuperAdmin = previousRoles.includes('super_admin');
      const willKeepSuperAdmin = requestedRoleNames.includes('super_admin');

      if (hadSuperAdmin && !willKeepSuperAdmin) {
        const otherActiveSuperAdmins = await tx.userRole.count({
          where: {
            organizationId: orgId,
            userId: { not: targetUserId },
            role: { name: 'super_admin' },
            user: { accountStatus: 'active' },
          },
        });

        if (otherActiveSuperAdmins === 0) {
          throw new ConflictException({
            code: 'LAST_SUPER_ADMIN',
            message: 'Cannot remove super_admin role from the last active Super Admin',
          });
        }
      }

      const hasDeptHeadRequested = requestedRoleNames.some(isDepartmentHeadRoleName);
      const lookupRoleNames = Array.from(
        new Set([
          ...requestedRoleNames,
          ...(hasDeptHeadRequested ? DEPT_HEAD_ROLE_NAMES : []),
        ]),
      );

      const candidateDbRoles = await tx.role.findMany({
        where: {
          organizationId: orgId,
          name: { in: lookupRoleNames },
        },
        select: { id: true, name: true },
      });

      const resolvedRoleMap = new Map<string, { id: string; name: string }>();
      for (const reqName of requestedRoleNames) {
        const matched = isDepartmentHeadRoleName(reqName)
          ? candidateDbRoles.find((r) => r.name === 'dept_head') ??
            candidateDbRoles.find((r) => r.name === 'department_head')
          : candidateDbRoles.find((r) => r.name === reqName);

        if (!matched) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: 'One or more requested roles do not exist in this organization',
          });
        }
        resolvedRoleMap.set(matched.id, matched);
      }

      const dbRoles = Array.from(resolvedRoleMap.values());
      const resolvedRoleNames = dbRoles.map((r) => r.name);

      await tx.userRole.deleteMany({
        where: {
          organizationId: orgId,
          userId: targetUserId,
        },
      });

      await tx.userRole.createMany({
        data: dbRoles.map((r) => ({
          organizationId: orgId,
          userId: targetUserId,
          roleId: r.id,
          assignedBy: caller.userId,
        })),
      });

      // Keep departments.head_employee_id synchronized with dept_head role assignment
      const targetEmployee = tx.employee?.findFirst
        ? await tx.employee.findFirst({
            where: { organizationId: orgId, userId: targetUserId },
            select: { id: true, departmentId: true },
          })
        : null;

      if (targetEmployee && tx.department) {
        const willBeDeptHead = isDepartmentHeadRole(resolvedRoleNames);

        if (willBeDeptHead) {
          const targetDeptId = dto.departmentId ?? targetEmployee.departmentId;
          const existingHeadedDepts = await tx.department.findMany({
            where: {
              organizationId: orgId,
              archivedAt: null,
              headEmployeeId: targetEmployee.id,
            },
            select: { id: true },
          });

          const targetDept = await tx.department.findFirst({
            where: {
              organizationId: orgId,
              id: targetDeptId,
              archivedAt: null,
            },
            select: {
              id: true,
              headEmployeeId: true,
              headEmployee: { select: { id: true, userId: true } },
            },
          });

          if (dto.departmentId && !targetDept) {
            throw new NotFoundException({
              code: 'NOT_FOUND',
              message: 'Department not found',
            });
          }

          if (targetDept) {
            const shouldAssignTargetDept =
              Boolean(dto.departmentId) ||
              (!targetDept.headEmployeeId && existingHeadedDepts.length === 0);

            if (
              shouldAssignTargetDept &&
              targetDept.headEmployeeId !== targetEmployee.id
            ) {
              await tx.department.update({
                where: {
                  organizationId_id: {
                    organizationId: orgId,
                    id: targetDept.id,
                  },
                },
                data: { headEmployeeId: targetEmployee.id },
              });

              const prevHeadEmpId = targetDept.headEmployeeId;
              const prevHeadUserId = targetDept.headEmployee?.userId ?? null;
              if (
                prevHeadEmpId &&
                prevHeadEmpId !== targetEmployee.id &&
                prevHeadUserId
              ) {
                const otherHeadedCount = await tx.department.count({
                  where: {
                    organizationId: orgId,
                    archivedAt: null,
                    headEmployeeId: prevHeadEmpId,
                    id: { not: targetDept.id },
                  },
                });

                if (otherHeadedCount === 0) {
                  const deptHeadRoleIds = candidateDbRoles
                    .filter((r) => isDepartmentHeadRoleName(r.name))
                    .map((r) => r.id);

                  if (deptHeadRoleIds.length > 0) {
                    await tx.userRole.deleteMany({
                      where: {
                        organizationId: orgId,
                        userId: prevHeadUserId,
                        roleId: { in: deptHeadRoleIds },
                      },
                    });
                  }
                }
              }
            }
          }
        } else {
          await tx.department.updateMany({
            where: {
              organizationId: orgId,
              archivedAt: null,
              headEmployeeId: targetEmployee.id,
            },
            data: { headEmployeeId: null },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: 'user.roles.updated',
          entityType: 'user',
          entityId: targetUserId,
          metadata: {
            previousRoles,
            newRoles: resolvedRoleNames,
          },
        },
      });

      return {
        id: targetUser.id,
        email: targetUser.email,
        displayName: targetUser.displayName,
        accountStatus: targetUser.accountStatus,
        roles: resolvedRoleNames,
      };
    });
  }
}
