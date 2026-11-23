import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private checkManagePermission(caller: AuthenticatedUser) {
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isHrManager = caller.roles.includes('hr_manager');

    if (!isSuperAdmin && !isHrManager) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only HR Managers or Super Admins can manage designations',
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

    return departments.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      headEmployeeId: d.headEmployeeId,
      headEmployee: d.headEmployee
        ? {
            id: d.headEmployee.id,
            name: `${d.headEmployee.firstName} ${d.headEmployee.lastName}`.trim(),
            employeeCode: d.headEmployee.employeeCode,
          }
        : null,
      activeEmployeeCount: d._count.employees,
      createdAt: d.createdAt,
    }));
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
