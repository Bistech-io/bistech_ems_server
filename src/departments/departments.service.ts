import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { hasPermission } from '../auth/permission.utils.js';
import type { AssignDepartmentHeadDto } from './dto/assign-department-head.dto.js';
import type {
  CreateDepartmentDto,
  UpdateDepartmentDto,
} from './dto/department.dto.js';

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private checkManagePermission(caller: AuthenticatedUser) {
    if (!hasPermission(caller, 'org.structure.manage', 'org')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to manage departments and designations',
      });
    }
  }

  async listDepartments(organizationId: string) {
    const departments = await this.prisma.department.findMany({
      where: {
        organizationId,
        archivedAt: null,
      },
      include: {
        headEmployee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
          },
        },
        employees: {
          where: {
            employmentStatus: 'active',
            departmentsHeaded: {
              none: {
                archivedAt: null,
              },
            },
            user: {
              userRoles: {
                some: {
                  role: {
                    name: { in: ['dept_head', 'department_head'] },
                  },
                },
              },
            },
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
          },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
        _count: {
          select: {
            employees: {
              where: { employmentStatus: 'active' },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return departments.map((d) => {
      const resolvedHead =
        d.headEmployee ??
        (d as { employees?: Array<{ id: string; firstName: string; lastName: string; employeeCode: string }> }).employees?.[0] ??
        null;

      return {
        id: d.id,
        name: d.name,
        description: d.description,
        headEmployeeId: resolvedHead?.id ?? null,
        headEmployee: resolvedHead
          ? {
              id: resolvedHead.id,
              name: `${resolvedHead.firstName} ${resolvedHead.lastName}`.trim(),
              employeeCode: resolvedHead.employeeCode,
            }
          : null,
        activeEmployeeCount: d._count.employees,
        createdAt: d.createdAt,
      };
    });
  }

  async createDepartment(
    organizationId: string,
    dto: CreateDepartmentDto,
    caller: AuthenticatedUser,
  ) {
    this.checkManagePermission(caller);

    const normalizedName = dto.name.trim();
    if (!normalizedName) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Department name is required',
      });
    }

    const existing = await this.prisma.department.findFirst({
      where: {
        organizationId,
        name: { equals: normalizedName, mode: 'insensitive' },
      },
      include: {
        _count: {
          select: {
            employees: { where: { employmentStatus: 'active' } },
          },
        },
      },
    });

    if (existing) {
      if (existing.archivedAt) {
        const restored = await this.prisma.department.update({
          where: { id: existing.id },
          data: {
            archivedAt: null,
            description: dto.description ?? existing.description,
          },
          include: {
            headEmployee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeCode: true,
              },
            },
          },
        });

        await this.prisma.auditLog.create({
          data: {
            organizationId,
            actorUserId: caller.userId,
            action: 'department.restored',
            entityType: 'department',
            entityId: restored.id,
            metadata: { departmentName: restored.name } as Prisma.InputJsonValue,
          },
        });

        return {
          id: restored.id,
          name: restored.name,
          description: restored.description,
          headEmployeeId: restored.headEmployeeId,
          headEmployee: restored.headEmployee
            ? {
                id: restored.headEmployee.id,
                name: `${restored.headEmployee.firstName} ${restored.headEmployee.lastName}`.trim(),
                employeeCode: restored.headEmployee.employeeCode,
              }
            : null,
          activeEmployeeCount: existing._count.employees,
          createdAt: restored.createdAt,
        };
      }

      throw new ConflictException({
        code: 'CONFLICT',
        message: 'A department with this name already exists',
      });
    }

    const created = await this.prisma.department.create({
      data: {
        organizationId,
        name: normalizedName,
        description: dto.description?.trim() || null,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorUserId: caller.userId,
        action: 'department.created',
        entityType: 'department',
        entityId: created.id,
        metadata: { departmentName: created.name } as Prisma.InputJsonValue,
      },
    });

    return {
      id: created.id,
      name: created.name,
      description: created.description,
      headEmployeeId: null,
      headEmployee: null,
      activeEmployeeCount: 0,
      createdAt: created.createdAt,
    };
  }

  async updateDepartment(
    organizationId: string,
    id: string,
    dto: UpdateDepartmentDto,
    caller: AuthenticatedUser,
  ) {
    this.checkManagePermission(caller);

    const existing = await this.prisma.department.findFirst({
      where: {
        id,
        organizationId,
        archivedAt: null,
      },
      include: {
        headEmployee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
          },
        },
        _count: {
          select: {
            employees: { where: { employmentStatus: 'active' } },
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Department not found',
      });
    }

    let normalizedName: string | undefined;
    if (dto.name !== undefined) {
      normalizedName = dto.name.trim();
      if (!normalizedName) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Department name is required',
        });
      }

      const duplicate = await this.prisma.department.findFirst({
        where: {
          organizationId,
          id: { not: id },
          name: { equals: normalizedName, mode: 'insensitive' },
          archivedAt: null,
        },
      });

      if (duplicate) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Another department with this name already exists',
        });
      }
    }

    const updated = await this.prisma.department.update({
      where: { id },
      data: {
        ...(normalizedName ? { name: normalizedName } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
      },
      include: {
        headEmployee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
          },
        },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorUserId: caller.userId,
        action: 'department.updated',
        entityType: 'department',
        entityId: updated.id,
        metadata: {
          previousName: existing.name,
          newName: updated.name,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      headEmployeeId: updated.headEmployeeId,
      headEmployee: updated.headEmployee
        ? {
            id: updated.headEmployee.id,
            name: `${updated.headEmployee.firstName} ${updated.headEmployee.lastName}`.trim(),
            employeeCode: updated.headEmployee.employeeCode,
          }
        : null,
      activeEmployeeCount: existing._count.employees,
      createdAt: updated.createdAt,
    };
  }

  async deleteDepartment(
    organizationId: string,
    id: string,
    caller: AuthenticatedUser,
  ) {
    this.checkManagePermission(caller);

    const existing = await this.prisma.department.findFirst({
      where: {
        id,
        organizationId,
        archivedAt: null,
      },
      include: {
        headEmployee: {
          select: { id: true, userId: true },
        },
        _count: {
          select: {
            employees: { where: { employmentStatus: 'active' } },
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Department not found',
      });
    }

    if (existing._count.employees > 0) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Cannot archive department while active employees are assigned to it',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      // Clear head and archive
      await tx.department.update({
        where: { id },
        data: {
          archivedAt: new Date(),
          headEmployeeId: null,
        },
      });

      // If department had a head, check if they head any other department
      if (existing.headEmployeeId && existing.headEmployee?.userId) {
        const otherHeaded = await tx.department.count({
          where: {
            organizationId,
            archivedAt: null,
            headEmployeeId: existing.headEmployeeId,
            id: { not: id },
          },
        });

        if (otherHeaded === 0) {
          const deptHeadRole = await tx.role.findFirst({
            where: { organizationId, name: { in: ['dept_head', 'department_head'] } },
            select: { id: true },
          });

          if (deptHeadRole) {
            await tx.userRole.deleteMany({
              where: {
                organizationId,
                userId: existing.headEmployee.userId,
                roleId: deptHeadRole.id,
              },
            });
          }
        }
      }

      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId: caller.userId,
          action: 'department.archived',
          entityType: 'department',
          entityId: id,
          metadata: { departmentName: existing.name } as Prisma.InputJsonValue,
        },
      });
    });
  }

  async assignDepartmentHead(
    departmentId: string,
    dto: AssignDepartmentHeadDto,
    caller: AuthenticatedUser,
  ) {
    if (!hasPermission(caller, 'department.head.assign', 'org')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to assign or remove a department head',
      });
    }

    const orgId = caller.organizationId;

    return this.prisma.$transaction(async (tx) => {
      // Lock department row
      await tx.$queryRaw`
        SELECT id FROM departments
        WHERE id = ${departmentId}::uuid AND organization_id = ${orgId}::uuid
        FOR UPDATE
      `;

      const department = await tx.department.findFirst({
        where: {
          id: departmentId,
          organizationId: orgId,
          archivedAt: null,
        },
        select: {
          id: true,
          name: true,
          headEmployeeId: true,
          headEmployee: {
            select: { id: true, userId: true },
          },
        },
      });

      if (!department) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Department not found',
        });
      }

      let newHeadUserId: string | null = null;
      if (dto.employeeId !== null) {
        const targetEmployee = await tx.employee.findFirst({
          where: {
            id: dto.employeeId,
            organizationId: orgId,
          },
          select: {
            id: true,
            userId: true,
            employmentStatus: true,
          },
        });

        if (!targetEmployee) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: 'Employee not found in this organization',
          });
        }
        if (targetEmployee.employmentStatus !== 'active') {
          throw new BadRequestException({
            code: 'EMPLOYEE_INACTIVE',
            message: 'Cannot assign an inactive employee as department head',
          });
        }
        newHeadUserId = targetEmployee.userId;
      }

      const deptHeadRole = await tx.role.findFirst({
        where: {
          organizationId: orgId,
          name: { in: ['dept_head', 'department_head'] },
        },
        select: { id: true },
      });

      const previousHeadEmployeeId = department.headEmployeeId;
      const previousHeadUserId = department.headEmployee?.userId ?? null;

      // Update department head
      const updated = await tx.department.update({
        where: {
          organizationId_id: {
            organizationId: orgId,
            id: department.id,
          },
        },
        data: {
          headEmployeeId: dto.employeeId,
        },
        include: {
          headEmployee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
            },
          },
        },
      });

      // Sync department_head role in user_roles
      if (deptHeadRole) {
        if (newHeadUserId) {
          await tx.userRole.upsert({
            where: {
              userId_roleId: {
                userId: newHeadUserId,
                roleId: deptHeadRole.id,
              },
            },
            update: {},
            create: {
              organizationId: orgId,
              userId: newHeadUserId,
              roleId: deptHeadRole.id,
              assignedBy: caller.userId,
            },
          });
        }

        if (
          previousHeadEmployeeId &&
          previousHeadEmployeeId !== dto.employeeId &&
          previousHeadUserId
        ) {
          const otherHeadedCount = await tx.department.count({
            where: {
              organizationId: orgId,
              archivedAt: null,
              headEmployeeId: previousHeadEmployeeId,
              id: { not: department.id },
            },
          });

          if (otherHeadedCount === 0) {
            await tx.userRole.deleteMany({
              where: {
                organizationId: orgId,
                userId: previousHeadUserId,
                roleId: deptHeadRole.id,
              },
            });
          }
        }
      }

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: dto.employeeId
            ? 'department.head.assigned'
            : 'department.head.removed',
          entityType: 'department',
          entityId: department.id,
          metadata: {
            departmentName: department.name,
            previousHeadEmployeeId,
            newHeadEmployeeId: dto.employeeId,
          } as Prisma.InputJsonValue,
        },
      });

      return {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        headEmployeeId: updated.headEmployeeId,
        headEmployee: updated.headEmployee
          ? {
              id: updated.headEmployee.id,
              name: `${updated.headEmployee.firstName} ${updated.headEmployee.lastName}`.trim(),
              employeeCode: updated.headEmployee.employeeCode,
            }
          : null,
      };
    });
  }

  async listDesignations(organizationId: string) {
    const designations = await this.prisma.designation.findMany({
      where: {
        organizationId,
        archivedAt: null,
      },
      include: {
        _count: {
          select: {
            employees: {
              where: { employmentStatus: 'active' },
            },
          },
        },
      },
      orderBy: { title: 'asc' },
    });

    return designations.map((d) => ({
      id: d.id,
      title: d.title,
      activeEmployeeCount: d._count.employees,
      createdAt: d.createdAt,
    }));
  }

  async createDesignation(organizationId: string, title: string, caller: AuthenticatedUser) {
    this.checkManagePermission(caller);

    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Designation title is required',
      });
    }

    const existing = await this.prisma.designation.findFirst({
      where: {
        organizationId,
        title: { equals: normalizedTitle, mode: 'insensitive' },
      },
      include: {
        _count: {
          select: {
            employees: {
              where: { employmentStatus: 'active' },
            },
          },
        },
      },
    });

    if (existing) {
      if (existing.archivedAt) {
        const restored = await this.prisma.designation.update({
          where: { id: existing.id },
          data: { archivedAt: null },
        });
        return {
          id: restored.id,
          title: restored.title,
          activeEmployeeCount: existing._count.employees,
          createdAt: restored.createdAt,
        };
      }
      return {
        id: existing.id,
        title: existing.title,
        activeEmployeeCount: existing._count.employees,
        createdAt: existing.createdAt,
      };
    }

    const created = await this.prisma.designation.create({
      data: {
        organizationId,
        title: normalizedTitle,
      },
    });

    return {
      id: created.id,
      title: created.title,
      activeEmployeeCount: 0,
      createdAt: created.createdAt,
    };
  }

  async updateDesignation(
    organizationId: string,
    id: string,
    title: string,
    caller: AuthenticatedUser,
  ) {
    this.checkManagePermission(caller);

    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Designation title is required',
      });
    }

    const existing = await this.prisma.designation.findFirst({
      where: {
        id,
        organizationId,
        archivedAt: null,
      },
      include: {
        _count: {
          select: {
            employees: {
              where: { employmentStatus: 'active' },
            },
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Designation not found',
      });
    }

    const duplicate = await this.prisma.designation.findFirst({
      where: {
        organizationId,
        id: { not: id },
        title: { equals: normalizedTitle, mode: 'insensitive' },
        archivedAt: null,
      },
    });

    if (duplicate) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Another designation with this title already exists',
      });
    }

    const updated = await this.prisma.designation.update({
      where: { id },
      data: { title: normalizedTitle },
    });

    return {
      id: updated.id,
      title: updated.title,
      activeEmployeeCount: existing._count.employees,
      createdAt: updated.createdAt,
    };
  }

  async deleteDesignation(organizationId: string, id: string, caller: AuthenticatedUser) {
    this.checkManagePermission(caller);

    const existing = await this.prisma.designation.findFirst({
      where: {
        id,
        organizationId,
        archivedAt: null,
      },
      include: {
        _count: {
          select: {
            employees: {
              where: { employmentStatus: 'active' },
            },
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Designation not found',
      });
    }

    if (existing._count.employees > 0) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Cannot archive designation while active employees are assigned to it',
      });
    }

    await this.prisma.designation.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }
}
