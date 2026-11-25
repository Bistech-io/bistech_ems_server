import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PermissionScope } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { hasPermission } from '../auth/permission.utils.js';
import {
  DEPT_HEAD_ROLE_NAMES,
  isDepartmentHeadRole,
  isDepartmentHeadRoleName,
} from '../auth/role.utils.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import type { CreateRoleDto, UpdateRoleDto } from './dto/role.dto.js';
import type { UpdateUserRolesDto } from './dto/update-user-roles.dto.js';

const RESERVED_ROLE_NAMES = new Set(['department_head', 'all', 'system']);

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private formatRoleDto(role: {
    id: string;
    name: string;
    description?: string | null;
    isSystem: boolean;
    createdAt?: Date;
    _count?: { userRoles: number };
    rolePermissions?: Array<{
      scope: PermissionScope | string;
      permission: { key: string; description: string };
    }>;
  }) {
    const userCount = role._count?.userRoles ?? 0;
    return {
      id: role.id,
      name: role.name,
      description: role.description ?? null,
      isSystem: role.isSystem,
      ...(role.createdAt ? { createdAt: role.createdAt.toISOString() } : {}),
      _count: { userRoles: userCount },
      userCount,
      permissions: (role.rolePermissions ?? []).map((rp) => ({
        key: rp.permission.key,
        description: rp.permission.description,
        scope: rp.scope,
      })),
    };
  }

  async listUsers(caller: AuthenticatedUser, query: ListUsersQueryDto) {
    const canReadUsers =
      hasPermission(caller, 'user.read', 'org') ||
      hasPermission(caller, 'role.manage', 'org');

    if (!canReadUsers) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to list organization users',
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
    const canViewRoles =
      hasPermission(caller, 'role.manage', 'org') ||
      hasPermission(caller, 'user.read', 'org');

    if (!canViewRoles) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to view roles',
      });
    }

    const roles = await this.prisma.role.findMany({
      where: { organizationId: caller.organizationId },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        isSystem: true,
        createdAt: true,
        _count: {
          select: { userRoles: true },
        },
        rolePermissions: {
          select: {
            scope: true,
            permission: {
              select: {
                key: true,
                description: true,
              },
            },
          },
          orderBy: {
            permission: { key: 'asc' },
          },
        },
      },
    });

    return roles.map((role) => this.formatRoleDto(role));
  }

  async listPermissions(caller: AuthenticatedUser) {
    const canViewPermissions =
      hasPermission(caller, 'role.manage', 'org') ||
      hasPermission(caller, 'user.read', 'org');

    if (!canViewPermissions) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to view the permissions catalog',
      });
    }

    return this.prisma.permission.findMany({
      orderBy: { key: 'asc' },
      select: {
        id: true,
        key: true,
        description: true,
      },
    });
  }

  private async resolveValidatedPermissionGrants(
    grants: Array<{ key: string; scope: string }>,
  ): Promise<Array<{ permissionId: string; key: string; scope: PermissionScope }>> {
    const deduped = new Map<string, PermissionScope>();
    for (const grant of grants) {
      deduped.set(grant.key.trim(), grant.scope as PermissionScope);
    }

    const requestedKeys = Array.from(deduped.keys());
    const dbPerms = await this.prisma.permission.findMany({
      where: { key: { in: requestedKeys } },
      select: { id: true, key: true },
    });

    const permByKey = new Map(dbPerms.map((p) => [p.key, p]));
    const unknownKeys = requestedKeys.filter((k) => !permByKey.has(k));
    if (unknownKeys.length > 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Unknown permission key(s): ${unknownKeys.join(', ')}`,
      });
    }

    return requestedKeys.map((key) => ({
      permissionId: permByKey.get(key)!.id,
      key,
      scope: deduped.get(key)!,
    }));
  }

  async createRole(dto: CreateRoleDto, caller: AuthenticatedUser) {
    if (!hasPermission(caller, 'role.manage', 'org')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only administrators with role management access can create custom roles',
      });
    }

    const normalizedName = dto.name.trim().toLowerCase();
    if (RESERVED_ROLE_NAMES.has(normalizedName)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Role key '${normalizedName}' is reserved`,
      });
    }

    const orgId = caller.organizationId;
    const existing = await this.prisma.role.findUnique({
      where: {
        organizationId_name: {
          organizationId: orgId,
          name: normalizedName,
        },
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException({
        code: 'ROLE_ALREADY_EXISTS',
        message: `A role with key '${normalizedName}' already exists in this organization`,
      });
    }

    const resolvedGrants = await this.resolveValidatedPermissionGrants(dto.permissions);

    const created = await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          organizationId: orgId,
          name: normalizedName,
          description: dto.description?.trim() || null,
          isSystem: false,
        },
      });

      await tx.rolePermission.createMany({
        data: resolvedGrants.map((g) => ({
          roleId: role.id,
          permissionId: g.permissionId,
          scope: g.scope,
        })),
      });

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: 'role.created',
          entityType: 'role',
          entityId: role.id,
          metadata: {
            name: role.name,
            description: role.description,
            permissions: resolvedGrants.map((g) => ({ key: g.key, scope: g.scope })),
          },
        },
      });

      return tx.role.findUniqueOrThrow({
        where: { id: role.id },
        select: {
          id: true,
          name: true,
          description: true,
          isSystem: true,
          createdAt: true,
          _count: { select: { userRoles: true } },
          rolePermissions: {
            select: {
              scope: true,
              permission: { select: { key: true, description: true } },
            },
            orderBy: { permission: { key: 'asc' } },
          },
        },
      });
    });

    return this.formatRoleDto(created);
  }

  async updateRole(
    roleId: string,
    dto: UpdateRoleDto,
    caller: AuthenticatedUser,
  ) {
    if (!hasPermission(caller, 'role.manage', 'org')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only administrators with role management access can edit custom roles',
      });
    }

    const orgId = caller.organizationId;
    const existing = await this.prisma.role.findUnique({
      where: {
        organizationId_id: {
          organizationId: orgId,
          id: roleId,
        },
      },
      select: { id: true, name: true, description: true, isSystem: true },
    });

    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Role not found in this organization',
      });
    }

    if (existing.isSystem) {
      throw new ForbiddenException({
        code: 'SYSTEM_ROLE_IMMUTABLE',
        message: 'Built-in system roles cannot be modified',
      });
    }

    const resolvedGrants = dto.permissions
      ? await this.resolveValidatedPermissionGrants(dto.permissions)
      : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id: existing.id },
        data: {
          ...(dto.description !== undefined
            ? { description: dto.description?.trim() || null }
            : {}),
        },
      });

      if (resolvedGrants) {
        await tx.rolePermission.deleteMany({
          where: { roleId: existing.id },
        });
        await tx.rolePermission.createMany({
          data: resolvedGrants.map((g) => ({
            roleId: existing.id,
            permissionId: g.permissionId,
            scope: g.scope,
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: 'role.updated',
          entityType: 'role',
          entityId: existing.id,
          metadata: {
            name: existing.name,
            ...(dto.description !== undefined
              ? { description: dto.description?.trim() || null }
              : {}),
            ...(resolvedGrants
              ? {
                  permissions: resolvedGrants.map((g) => ({
                    key: g.key,
                    scope: g.scope,
                  })),
                }
              : {}),
          },
        },
      });

      return tx.role.findUniqueOrThrow({
        where: { id: existing.id },
        select: {
          id: true,
          name: true,
          description: true,
          isSystem: true,
          createdAt: true,
          _count: { select: { userRoles: true } },
          rolePermissions: {
            select: {
              scope: true,
              permission: { select: { key: true, description: true } },
            },
            orderBy: { permission: { key: 'asc' } },
          },
        },
      });
    });

    return this.formatRoleDto(updated);
  }

  async deleteRole(roleId: string, caller: AuthenticatedUser) {
    if (!hasPermission(caller, 'role.manage', 'org')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only administrators with role management access can delete custom roles',
      });
    }

    const orgId = caller.organizationId;
    const existing = await this.prisma.role.findUnique({
      where: {
        organizationId_id: {
          organizationId: orgId,
          id: roleId,
        },
      },
      select: {
        id: true,
        name: true,
        isSystem: true,
      },
    });

    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Role not found in this organization',
      });
    }

    if (existing.isSystem) {
      throw new ForbiddenException({
        code: 'SYSTEM_ROLE_IMMUTABLE',
        message: 'Built-in system roles cannot be deleted',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const assignedUsers = await tx.userRole.findMany({
        where: {
          organizationId: orgId,
          roleId: existing.id,
        },
        select: { userId: true },
      });

      const affectedUserIds = Array.from(new Set(assignedUsers.map((u) => u.userId)));

      await tx.userRole.deleteMany({
        where: {
          organizationId: orgId,
          roleId: existing.id,
        },
      });

      // Guarantee every affected user retains at least the baseline employee role
      if (affectedUserIds.length > 0) {
        const employeeRole = await tx.role.findUnique({
          where: {
            organizationId_name: {
              organizationId: orgId,
              name: 'employee',
            },
          },
          select: { id: true },
        });

        if (employeeRole) {
          for (const userId of affectedUserIds) {
            const remainingCount = await tx.userRole.count({
              where: { organizationId: orgId, userId },
            });
            if (remainingCount === 0) {
              await tx.userRole.create({
                data: {
                  organizationId: orgId,
                  userId,
                  roleId: employeeRole.id,
                  assignedBy: caller.userId,
                },
              });
            }
          }
        }
      }

      await tx.role.delete({
        where: { id: existing.id },
      });

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: 'role.deleted',
          entityType: 'role',
          entityId: existing.id,
          metadata: {
            name: existing.name,
            detachedUsersCount: affectedUserIds.length,
          },
        },
      });

      return {
        id: existing.id,
        name: existing.name,
        detachedUsersCount: affectedUserIds.length,
      };
    });
  }

  async updateUserRoles(
    targetUserId: string,
    dto: UpdateUserRolesDto,
    caller: AuthenticatedUser,
  ) {
    if (!hasPermission(caller, 'role.manage', 'org')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only administrators with role management access can assign or update user roles',
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
