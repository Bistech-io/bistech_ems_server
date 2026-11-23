import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class TasksRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findCallerEmployeeContext(organizationId: string, userId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { organizationId, userId },
      select: {
        id: true,
        departmentId: true,
        employmentStatus: true,
        departmentsHeaded: {
          where: { organizationId, archivedAt: null },
          select: { id: true },
        },
      },
    });

    return {
      employeeId: employee?.id ?? null,
      departmentId: employee?.departmentId ?? null,
      isActive: employee?.employmentStatus === 'active',
      headedDepartmentIds: employee?.departmentsHeaded.map((d) => d.id) ?? [],
    };
  }
}
