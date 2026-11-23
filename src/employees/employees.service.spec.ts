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
});
