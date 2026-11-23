import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { PrismaService } from '../database/prisma.service.js';
import type { UpdateEmployeeProfileDto } from './dto/update-employee-profile.dto.js';
import {
  toSensitiveProfileDto,
  type SensitiveEmployeeProfileDto,
} from './profile.mapper.js';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getSensitiveProfile(
    employeeId: string,
    caller: AuthenticatedUser,
  ): Promise<SensitiveEmployeeProfileDto> {
    const employee = await this.prisma.employee.findUnique({
      where: {
        organizationId_id: {
          organizationId: caller.organizationId,
          id: employeeId,
        },
      },
      include: {
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, title: true } },
        profile: true,
      },
    });

    if (!employee) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Employee record not found',
      });
    }

    const isHrOrAdmin =
      caller.roles.includes('super_admin') || caller.roles.includes('hr_manager');
    const isOwner = employee.userId === caller.userId;

    // FSD T-16: Out-of-scope profile access returns 404 without leakage
    if (!isHrOrAdmin && !isOwner) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Employee record not found',
      });
    }

    // FSD T-21: Non-owner sensitive profile reads are audited
    if (!isOwner) {
      await this.prisma.auditLog.create({
        data: {
          organizationId: caller.organizationId,
          actorUserId: caller.userId,
          action: 'employee.profile.read',
          entityType: 'employee_profile',
          entityId: employee.id,
          metadata: {
            employeeCode: employee.employeeCode,
          },
        },
      });
    }

    return toSensitiveProfileDto(employee);
  }

  async updateSensitiveProfile(
    employeeId: string,
    dto: UpdateEmployeeProfileDto,
    caller: AuthenticatedUser,
  ): Promise<SensitiveEmployeeProfileDto> {
    const isHrOrAdmin =
      caller.roles.includes('super_admin') || caller.roles.includes('hr_manager');

    if (!isHrOrAdmin) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only HR Managers or Super Admins can update employee personal profiles',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findUnique({
        where: {
          organizationId_id: {
            organizationId: caller.organizationId,
            id: employeeId,
          },
        },
        include: {
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, title: true } },
        },
      });

      if (!employee) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Employee record not found',
        });
      }

      const updateData: Record<string, unknown> = {};
      if (dto.dateOfBirth !== undefined) {
        updateData.dateOfBirth = dto.dateOfBirth
          ? new Date(`${dto.dateOfBirth}T00:00:00Z`)
          : null;
      }
      if (dto.personalEmail !== undefined) updateData.personalEmail = dto.personalEmail;
      if (dto.personalPhone !== undefined) updateData.personalPhone = dto.personalPhone;
      if (dto.addressLine !== undefined) updateData.addressLine = dto.addressLine;
      if (dto.city !== undefined) updateData.city = dto.city;
      if (dto.countryCode !== undefined) updateData.countryCode = dto.countryCode;
      if (dto.emergencyContactName !== undefined) {
        updateData.emergencyContactName = dto.emergencyContactName;
      }
      if (dto.emergencyContactPhone !== undefined) {
        updateData.emergencyContactPhone = dto.emergencyContactPhone;
      }
      if (dto.emergencyContactRelation !== undefined) {
        updateData.emergencyContactRelation = dto.emergencyContactRelation;
      }

      const profile = await tx.employeeProfile.upsert({
        where: { employeeId: employee.id },
        update: updateData,
        create: {
          employeeId: employee.id,
          organizationId: caller.organizationId,
          ...updateData,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: caller.organizationId,
          actorUserId: caller.userId,
          action: 'employee.profile.updated',
          entityType: 'employee_profile',
          entityId: employee.id,
          metadata: {
            employeeCode: employee.employeeCode,
            updatedFields: Object.keys(updateData),
          },
        },
      });

      return toSensitiveProfileDto({
        ...employee,
        profile,
      });
    });
  }
}
