import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

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
}

