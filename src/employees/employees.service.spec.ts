import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmployeesService } from './employees.service.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';

describe('EmployeesService', () => {
  let service: EmployeesService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      department: { findUnique: vi.fn(), findFirst: vi.fn() },
      designation: { findUnique: vi.fn(), findFirst: vi.fn() },
      user: { findUnique: vi.fn() },
      $transaction: vi.fn(async (cb) => {
        const tx = {
          organization: {
            findUniqueOrThrow: vi.fn().mockResolvedValue({
              id: 'org-1',
              lastEmployeeNumber: 1009,
              employeeCodePrefix: 'BST',
            }),
            update: vi.fn().mockResolvedValue({}),
          },
          user: {
            create: vi.fn().mockResolvedValue({
              id: 'user-101',
              username: 'test.emp',
              displayName: 'Test Employee',
              email: 'test@bistech.io',
              accountStatus: 'active',
            }),
          },
          role: { findUnique: vi.fn().mockResolvedValue({ id: 'role-emp' }) },
          userRole: { create: vi.fn().mockResolvedValue({}) },
          employee: {
            create: vi.fn().mockResolvedValue({
              id: 'emp-101',
              firstName: 'Test',
              lastName: 'Employee',
              workEmail: 'test@bistech.io',
              phone: null,
              employmentType: 'full_time',
              employmentStatus: 'active',
              joiningDate: new Date('2026-11-23'),
              createdAt: new Date(),
            }),
          },
          employeeProfile: { create: vi.fn().mockResolvedValue({}) },
          employeeEmploymentHistory: { create: vi.fn().mockResolvedValue({}) },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      }),
    };

    service = new EmployeesService(mockPrisma as unknown as PrismaService);
  });

  it('creates employee and returns fullName matching firstName and lastName', async () => {
    mockPrisma.department.findUnique.mockResolvedValue({
      id: 'dept-1',
      name: 'Engineering',
      archivedAt: null,
    });
    mockPrisma.designation.findUnique.mockResolvedValue({
      id: 'desig-1',
      title: 'Junior HR',
      archivedAt: null,
    });
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const caller: AuthenticatedUser = {
      userId: 'admin-1',
      organizationId: 'org-1',
      sessionId: 'sess-1',
      roles: ['super_admin'],
    };

    const res = await service.createEmployee(
      {
        firstName: 'Test',
        lastName: 'Employee',
        workEmail: 'test@bistech.io',
        departmentId: 'dept-1',
        designationId: 'desig-1',
        employmentType: 'full_time',
        joiningDate: '2026-11-23',
      },
      caller,
    );

    expect(res).toBeDefined();
    expect(res.fullName).toBe('Test Employee');
    expect(res.employeeCode).toBe('BST-1010');
    expect(res.designation.title).toBe('Junior HR');
  });

  it('hides out-of-scope employee records with 404 NOT_FOUND for employee role', async () => {
    const prisma = {
      employee: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'emp-other',
          employeeCode: 'BST-1002',
          firstName: 'Other',
          lastName: 'Person',
          workEmail: 'other@bistech.io',
          phone: null,
          employmentType: 'full_time',
          employmentStatus: 'active',
          joiningDate: new Date('2026-01-01'),
          createdAt: new Date(),
          department: { id: 'dept-1', name: 'Engineering' },
          designation: { id: 'desig-1', title: 'Engineer' },
          user: {
            id: 'user-other',
            username: 'other',
            displayName: 'Other Person',
            email: 'other@bistech.io',
            accountStatus: 'active',
            userRoles: [{ role: { name: 'employee' } }],
          },
        }),
      },
    } as unknown as PrismaService;

    const scopedService = new EmployeesService(prisma);
    const caller: AuthenticatedUser = {
      userId: 'user-emp-1',
      organizationId: 'org-1',
      sessionId: 'sess-1',
      roles: ['employee'],
    };

    await expect(scopedService.getEmployeeById('emp-other', caller)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects updateEmployee for non-HR/non-Admin callers with 403 FORBIDDEN', async () => {
    const caller: AuthenticatedUser = {
      userId: 'user-emp-1',
      organizationId: 'org-1',
      sessionId: 'sess-1',
      roles: ['employee'],
    };

    await expect(
      service.updateEmployee('emp-101', { departmentId: 'dept-2' }, caller),
    ).rejects.toThrow(ForbiddenException);
  });

  it('updates employee department and returns updated profile for HR/Admin', async () => {
    const historyCreate = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const empUpdate = vi.fn().mockResolvedValue({});

    const prisma = {
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          employee: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'emp-101',
              departmentId: 'dept-1',
              designationId: 'desig-1',
            }),
            update: empUpdate,
          },
          department: {
            findFirst: vi.fn().mockResolvedValue({ id: 'dept-2' }),
          },
          designation: {
            findFirst: vi.fn(),
            create: vi.fn(),
          },
          employeeEmploymentHistory: { create: historyCreate },
          auditLog: { create: auditCreate },
        }),
      ),
      employee: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'emp-101',
          employeeCode: 'BST-1010',
          firstName: 'Test',
          lastName: 'Employee',
          workEmail: 'test@bistech.io',
          phone: null,
          employmentType: 'full_time',
          employmentStatus: 'active',
          joiningDate: new Date('2026-11-23'),
          createdAt: new Date(),
          department: { id: 'dept-2', name: 'Product' },
          designation: { id: 'desig-1', title: 'Engineer' },
          user: {
            id: 'user-101',
            username: 'test.emp',
            displayName: 'Test Employee',
            email: 'test@bistech.io',
            accountStatus: 'active',
            userRoles: [{ role: { name: 'employee' } }],
          },
        }),
      },
    } as unknown as PrismaService;

    const hrService = new EmployeesService(prisma);
    const caller: AuthenticatedUser = {
      userId: 'hr-1',
      organizationId: 'org-1',
      sessionId: 'sess-1',
      roles: ['hr_manager'],
    };

    const res = await hrService.updateEmployee(
      'emp-101',
      { departmentId: 'dept-2', reason: 'Transfer' },
      caller,
    );

    expect(res.department.id).toBe('dept-2');
    expect(empUpdate).toHaveBeenCalled();
    expect(historyCreate).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalled();
  });

  it('freezes and unfreezes employee account, revoking sessions on freeze, and rejects self-freeze or employee caller', async () => {
    const userUpdate = vi.fn().mockResolvedValue({});
    const sessionUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
    const auditCreate = vi.fn().mockResolvedValue({});
    let currentAccountStatus = 'active';

    const prisma = {
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          employee: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'emp-101',
              userId: 'user-101',
              user: {
                id: 'user-101',
                accountStatus: currentAccountStatus,
                userRoles: [{ role: { name: 'employee' } }],
              },
            }),
          },
          user: {
            update: vi.fn(async (args: { data: { accountStatus: string } }) => {
              currentAccountStatus = args.data.accountStatus;
              return userUpdate(args);
            }),
          },
          userSession: { updateMany: sessionUpdateMany },
          auditLog: { create: auditCreate },
        }),
      ),
      employee: {
        findUnique: vi.fn(async () => ({
          id: 'emp-101',
          employeeCode: 'BST-1010',
          firstName: 'Test',
          lastName: 'Employee',
          workEmail: 'test@bistech.io',
          phone: null,
          employmentType: 'full_time',
          employmentStatus: 'active',
          joiningDate: new Date('2026-11-23'),
          createdAt: new Date(),
          department: { id: 'dept-1', name: 'Engineering' },
          designation: { id: 'desig-1', title: 'Engineer' },
          user: {
            id: 'user-101',
            username: 'test.emp',
            displayName: 'Test Employee',
            email: 'test@bistech.io',
            accountStatus: currentAccountStatus,
            userRoles: [{ role: { name: 'employee' } }],
          },
        })),
      },
    } as unknown as PrismaService;

    const hrService = new EmployeesService(prisma);
    const hrCaller: AuthenticatedUser = {
      userId: 'hr-1',
      organizationId: 'org-1',
      sessionId: 'sess-1',
      roles: ['hr_manager'],
    };
    const empCaller: AuthenticatedUser = {
      userId: 'user-101',
      organizationId: 'org-1',
      sessionId: 'sess-2',
      roles: ['employee'],
    };
    const selfAdminCaller: AuthenticatedUser = {
      userId: 'user-101',
      organizationId: 'org-1',
      sessionId: 'sess-3',
      roles: ['super_admin'],
    };

    await expect(
      hrService.updateEmployeeAccountStatus('emp-101', { frozen: true }, empCaller),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      hrService.updateEmployeeAccountStatus('emp-101', { frozen: true }, selfAdminCaller),
    ).rejects.toThrow(BadRequestException);

    const frozenRes = await hrService.updateEmployeeAccountStatus(
      'emp-101',
      { frozen: true, reason: 'Policy review' },
      hrCaller,
    );
    expect(frozenRes.user.accountStatus).toBe('suspended');
    expect(sessionUpdateMany).toHaveBeenCalledTimes(1);

    const unfrozenRes = await hrService.updateEmployeeAccountStatus(
      'emp-101',
      { frozen: false },
      hrCaller,
    );
    expect(unfrozenRes.user.accountStatus).toBe('active');
    expect(auditCreate).toHaveBeenCalledTimes(2);
  });
});
