import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  EmploymentType,
  EmploymentStatus,
  HistoryEventType,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { CreateEmployeeDto } from './dto/create-employee.dto.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  async createEmployee(
    dto: CreateEmployeeDto,
    caller: AuthenticatedUser,
    idempotencyKey?: string,
  ) {
    const orgId = caller.organizationId;

    // 1. Role permission checks
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isHrManager = caller.roles.includes('hr_manager');

    if (!isSuperAdmin && !isHrManager) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only HR Managers or Super Admins can create employees and accounts',
      });
    }

    const assignedRoles = dto.roles && dto.roles.length > 0 ? dto.roles : ['employee'];
    if (assignedRoles.some((r) => r !== 'employee') && !isSuperAdmin) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only Super Admins can assign management roles during onboarding',
      });
    }

    // 2. Validate department and designation
    const department = await this.prisma.department.findUnique({
      where: {
        organizationId_id: {
          organizationId: orgId,
          id: dto.departmentId,
        },
      },
    });

    if (!department || department.archivedAt) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Department not found in this organization',
      });
    }

    const designation = await this.prisma.designation.findUnique({
      where: {
        organizationId_id: {
          organizationId: orgId,
          id: dto.designationId,
        },
      },
    });

    if (!designation || designation.archivedAt) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Designation not found in this organization',
      });
    }

    // 3. Check duplicate email
    const normalizedEmail = dto.workEmail.trim().toLowerCase();
    const existingUserByEmail = await this.prisma.user.findUnique({
      where: {
        organizationId_email: {
          organizationId: orgId,
          email: normalizedEmail,
        },
      },
    });

    if (existingUserByEmail) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'An account with this email address already exists in this workspace',
      });
    }

    // 4. Derive & check username
    const derivedUsername = (
      dto.username?.trim().toLowerCase() ||
      normalizedEmail.split('@')[0] ||
      `${dto.firstName.toLowerCase()}.${dto.lastName.toLowerCase()}`
    ).replace(/[^a-z0-9._-]/g, '');

    const existingUserByUsername = await this.prisma.user.findUnique({
      where: {
        organizationId_username: {
          organizationId: orgId,
          username: derivedUsername,
        },
      },
    });

    if (existingUserByUsername) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Username '${derivedUsername}' is already taken in this workspace`,
      });
    }

    // 5. Hash password
    const rawPassword = dto.password || 'Password123!';
    const passwordHash = await argon2.hash(rawPassword, {
      type: argon2.argon2id,
    });

    const displayName = `${dto.firstName} ${dto.lastName}`.trim();

    // 6. Execute atomic transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // 6.1 Lock organization and generate next employee number (BST-1001, BST-1002, etc.)
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: orgId },
      });

      const nextNumber = org.lastEmployeeNumber < 1000 ? 1001 : org.lastEmployeeNumber + 1;
      const employeeCode = `${org.employeeCodePrefix}-${nextNumber}`;

      await tx.organization.update({
        where: { id: orgId },
        data: { lastEmployeeNumber: nextNumber },
      });

      // 6.2 Create User
      const user = await tx.user.create({
        data: {
          organizationId: orgId,
          username: derivedUsername,
          email: normalizedEmail,
          displayName,
          passwordHash,
          accountStatus: 'active',
        },
      });

      // 6.3 Assign Roles
      for (const roleName of assignedRoles) {
        const role = await tx.role.findUnique({
          where: {
            organizationId_name: {
              organizationId: orgId,
              name: roleName,
            },
          },
        });

        if (role) {
          await tx.userRole.create({
            data: {
              organizationId: orgId,
              userId: user.id,
              roleId: role.id,
              assignedBy: caller.userId,
            },
          });
        }
      }

      // 6.4 Create Employee
      const employee = await tx.employee.create({
        data: {
          organizationId: orgId,
          userId: user.id,
          employeeCode,
          firstName: dto.firstName,
          lastName: dto.lastName,
          workEmail: normalizedEmail,
          phone: dto.phone || null,
          departmentId: dto.departmentId,
          designationId: dto.designationId,
          employmentType: dto.employmentType as EmploymentType,
          employmentStatus: EmploymentStatus.active,
          joiningDate: new Date(dto.joiningDate),
        },
      });

      // 6.5 Create Profile
      const prof = dto.personalProfile;
      await tx.employeeProfile.create({
        data: {
          organizationId: orgId,
          employeeId: employee.id,
          dateOfBirth: prof?.dateOfBirth ? new Date(prof.dateOfBirth) : null,
          personalEmail: prof?.personalEmail || null,
          personalPhone: prof?.personalPhone || null,
          addressLine: prof?.addressLine || null,
          city: prof?.city || null,
          countryCode: prof?.countryCode || null,
          emergencyContactName: prof?.emergencyContactName || null,
          emergencyContactPhone: prof?.emergencyContactPhone || null,
          emergencyContactRelation: prof?.emergencyContactRelation || null,
        },
      });

      // 6.6 Append Employment History
      await tx.employeeEmploymentHistory.create({
        data: {
          organizationId: orgId,
          employeeId: employee.id,
          eventType: HistoryEventType.hired,
          effectiveDate: new Date(dto.joiningDate),
          reason: 'Initial employee onboarding',
          changedBy: caller.userId,
          newValue: {
            departmentId: dto.departmentId,
            designationId: dto.designationId,
            employmentType: dto.employmentType,
          },
        },
      });

      // 6.7 Create Audit Log
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: 'employee.created',
          entityType: 'employee',
          entityId: employee.id,
          metadata: {
            employeeCode,
            username: derivedUsername,
            roles: assignedRoles,
            idempotencyKey,
          },
        },
      });

      return {
        id: employee.id,
        employeeCode,
        firstName: employee.firstName,
        lastName: employee.lastName,
        fullName: `${employee.firstName} ${employee.lastName}`.trim(),
        workEmail: employee.workEmail,
        phone: employee.phone,
        department: {
          id: department.id,
          name: department.name,
        },
        designation: {
          id: designation.id,
          title: designation.title,
        },
        employmentType: employee.employmentType,
        employmentStatus: employee.employmentStatus,
        joiningDate: employee.joiningDate,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          email: user.email,
          accountStatus: user.accountStatus,
          roles: assignedRoles,
        },
        createdAt: employee.createdAt,
      };
    });

    return result;
  }

  async listEmployees(
    caller: AuthenticatedUser,
    params?: {
      departmentId?: string;
      employmentStatus?: EmploymentStatus;
      search?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const orgId = caller.organizationId;
    const page = Math.max(Number(params?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(params?.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {
      organizationId: orgId,
    };

    if (params?.departmentId) {
      where.departmentId = params.departmentId;
    }

    if (params?.employmentStatus) {
      where.employmentStatus = params.employmentStatus;
    }

    if (params?.search) {
      const search = params.search.trim();
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
        { workEmail: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({
        where,
        skip,
        take: limit,
        include: {
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, title: true } },
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              email: true,
              accountStatus: true,
              userRoles: {
                select: {
                  role: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: { employeeCode: 'asc' },
      }),
    ]);

    const data = items.map((e) => ({
      id: e.id,
      employeeCode: e.employeeCode,
      firstName: e.firstName,
      lastName: e.lastName,
      fullName: `${e.firstName} ${e.lastName}`.trim(),
      workEmail: e.workEmail,
      phone: e.phone,
      department: e.department,
      designation: e.designation,
      employmentType: e.employmentType,
      employmentStatus: e.employmentStatus,
      joiningDate: e.joiningDate,
      user: {
        id: e.user.id,
        username: e.user.username,
        displayName: e.user.displayName,
        email: e.user.email,
        accountStatus: e.user.accountStatus,
        roles: e.user.userRoles.map((ur) => ur.role.name),
      },
      createdAt: e.createdAt,
    }));

    return {
      items: data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getEmployeeById(id: string, caller: AuthenticatedUser) {
    const employee = await this.prisma.employee.findUnique({
      where: {
        organizationId_id: {
          organizationId: caller.organizationId,
          id,
        },
      },
      include: {
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, title: true } },
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            email: true,
            accountStatus: true,
            userRoles: {
              select: {
                role: { select: { name: true } },
              },
            },
          },
        },
        profile: true,
      },
    });

    if (!employee) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Employee record not found',
      });
    }

    return {
      id: employee.id,
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
      fullName: `${employee.firstName} ${employee.lastName}`.trim(),
      workEmail: employee.workEmail,
      phone: employee.phone,
      department: employee.department,
      designation: employee.designation,
      employmentType: employee.employmentType,
      employmentStatus: employee.employmentStatus,
      joiningDate: employee.joiningDate,
      user: {
        id: employee.user.id,
        username: employee.user.username,
        displayName: employee.user.displayName,
        email: employee.user.email,
        accountStatus: employee.user.accountStatus,
        roles: employee.user.userRoles.map((ur) => ur.role.name),
      },
      createdAt: employee.createdAt,
    };
  }
}

