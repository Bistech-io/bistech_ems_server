import { ForbiddenException } from '@nestjs/common';
import { vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import type { PrismaService } from '../database/prisma.service.js';
import { DepartmentsService } from './departments.service.js';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const DEPT_ID = '22222222-2222-2222-2222-222222222222';
const OLD_EMP_ID = '33333333-3333-3333-3333-333333333333';
const NEW_EMP_ID = '44444444-4444-4444-4444-444444444444';
const OLD_USER_ID = '55555555-5555-5555-5555-555555555555';
const NEW_USER_ID = '66666666-6666-6666-6666-666666666666';

const SUPER_ADMIN: AuthenticatedUser = {
  userId: 'admin-user-id',
  organizationId: ORG_ID,
  sessionId: 'sess-1',
  roles: ['super_admin'],
};

const HR_CALLER: AuthenticatedUser = {
  userId: 'hr-user-id',
  organizationId: ORG_ID,
  sessionId: 'sess-2',
  roles: ['hr_manager'],
};

describe('DepartmentsService - assignDepartmentHead', () => {
  it('rejects non-SuperAdmin callers with 403 FORBIDDEN', async () => {
    const prisma = {} as unknown as PrismaService;
    const service = new DepartmentsService(prisma);

    await expect(
      service.assignDepartmentHead(DEPT_ID, { employeeId: NEW_EMP_ID }, HR_CALLER),
    ).rejects.toThrow(ForbiddenException);
  });

  it('assigns new head, grants department_head role, revokes old head role when heading no other dept, and writes audit log', async () => {
    const userRoleUpsert = vi.fn().mockResolvedValue({});
    const userRoleDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue({});

    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRaw: vi.fn().mockResolvedValue([{ id: DEPT_ID }]),
          department: {
            findFirst: vi.fn().mockResolvedValue({
              id: DEPT_ID,
              name: 'Engineering',
              headEmployeeId: OLD_EMP_ID,
              headEmployee: { id: OLD_EMP_ID, userId: OLD_USER_ID },
            }),
            update: vi.fn().mockResolvedValue({
              id: DEPT_ID,
              name: 'Engineering',
              description: null,
              headEmployeeId: NEW_EMP_ID,
              headEmployee: {
                id: NEW_EMP_ID,
                firstName: 'Farhan',
                lastName: 'Ahmed',
                employeeCode: 'BST-1002',
              },
            }),
            count: vi.fn().mockResolvedValue(0),
          },
          employee: {
            findFirst: vi.fn().mockResolvedValue({
              id: NEW_EMP_ID,
              userId: NEW_USER_ID,
              employmentStatus: 'active',
            }),
          },
          role: {
            findFirst: vi.fn().mockResolvedValue({ id: 'role-dept-head' }),
          },
          userRole: {
            upsert: userRoleUpsert,
            deleteMany: userRoleDeleteMany,
          },
          auditLog: {
            create: auditCreate,
          },
        }),
      ),
    } as unknown as PrismaService;

    const service = new DepartmentsService(prisma);
    const result = await service.assignDepartmentHead(
      DEPT_ID,
      { employeeId: NEW_EMP_ID },
      SUPER_ADMIN,
    );

    expect(result.headEmployeeId).toBe(NEW_EMP_ID);
    expect(userRoleUpsert).toHaveBeenCalled();
    expect(userRoleDeleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        userId: OLD_USER_ID,
        roleId: 'role-dept-head',
      },
    });
    expect(auditCreate).toHaveBeenCalled();
  });

  it('keeps department_head role on previous head if they still head another department', async () => {
    const userRoleDeleteMany = vi.fn();

    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRaw: vi.fn().mockResolvedValue([{ id: DEPT_ID }]),
          department: {
            findFirst: vi.fn().mockResolvedValue({
              id: DEPT_ID,
              name: 'Engineering',
              headEmployeeId: OLD_EMP_ID,
              headEmployee: { id: OLD_EMP_ID, userId: OLD_USER_ID },
            }),
            update: vi.fn().mockResolvedValue({
              id: DEPT_ID,
              name: 'Engineering',
              description: null,
              headEmployeeId: null,
              headEmployee: null,
            }),
            count: vi.fn().mockResolvedValue(1),
          },
          role: {
            findFirst: vi.fn().mockResolvedValue({ id: 'role-dept-head' }),
          },
          userRole: {
            deleteMany: userRoleDeleteMany,
          },
          auditLog: {
            create: vi.fn().mockResolvedValue({}),
          },
        }),
      ),
    } as unknown as PrismaService;

    const service = new DepartmentsService(prisma);
    const result = await service.assignDepartmentHead(
      DEPT_ID,
      { employeeId: null },
      SUPER_ADMIN,
    );

    expect(result.headEmployeeId).toBeNull();
    expect(userRoleDeleteMany).not.toHaveBeenCalled();
  });
});
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DepartmentsService } from './departments.service.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';

describe('DepartmentsService - Designations', () => {
  let service: DepartmentsService;
  let prismaMock: any;

  const mockAdmin: AuthenticatedUser = {
    userId: 'user-admin',
    organizationId: 'org-1',
    sessionId: 'session-1',
    roles: ['super_admin'],
  };

  const mockHr: AuthenticatedUser = {
    userId: 'user-hr',
    organizationId: 'org-1',
    sessionId: 'session-2',
    roles: ['hr_manager'],
  };

  const mockEmployee: AuthenticatedUser = {
    userId: 'user-emp',
    organizationId: 'org-1',
    sessionId: 'session-3',
    roles: ['employee'],
  };

  beforeEach(() => {
    prismaMock = {
      department: {
        findMany: vi.fn(),
      },
      designation: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    };

    service = new DepartmentsService(prismaMock as unknown as PrismaService);
  });

  describe('createDesignation', () => {
    it('creates a new designation when it does not exist', async () => {
      prismaMock.designation.findFirst.mockResolvedValue(null);
      prismaMock.designation.create.mockResolvedValue({
        id: 'desig-1',
        organizationId: 'org-1',
        title: 'Junior Software Developer',
        createdAt: new Date('2026-11-23T00:00:00Z'),
      });

      const result = await service.createDesignation(
        'org-1',
        'Junior Software Developer',
        mockHr,
      );

      expect(prismaMock.designation.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          title: 'Junior Software Developer',
        },
      });
      expect(result).toEqual({
        id: 'desig-1',
        title: 'Junior Software Developer',
        activeEmployeeCount: 0,
        createdAt: new Date('2026-11-23T00:00:00Z'),
      });
    });

    it('returns existing designation if already present and active', async () => {
      prismaMock.designation.findFirst.mockResolvedValue({
        id: 'desig-existing',
        organizationId: 'org-1',
        title: 'Junior Software Developer',
        archivedAt: null,
        createdAt: new Date('2026-11-20T00:00:00Z'),
        _count: { employees: 2 },
      });

      const result = await service.createDesignation(
        'org-1',
        'junior software developer',
        mockAdmin,
      );

      expect(prismaMock.designation.create).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: 'desig-existing',
        title: 'Junior Software Developer',
        activeEmployeeCount: 2,
        createdAt: new Date('2026-11-20T00:00:00Z'),
      });
    });

    it('unarchives existing designation if previously archived', async () => {
      prismaMock.designation.findFirst.mockResolvedValue({
        id: 'desig-archived',
        organizationId: 'org-1',
        title: 'QA Engineer',
        archivedAt: new Date('2026-10-01T00:00:00Z'),
        _count: { employees: 0 },
      });
      prismaMock.designation.update.mockResolvedValue({
        id: 'desig-archived',
        title: 'QA Engineer',
        archivedAt: null,
        createdAt: new Date('2026-09-01T00:00:00Z'),
      });

      const result = await service.createDesignation('org-1', 'QA Engineer', mockHr);

      expect(prismaMock.designation.update).toHaveBeenCalledWith({
        where: { id: 'desig-archived' },
        data: { archivedAt: null },
      });
      expect(result.id).toBe('desig-archived');
    });

    it('throws ForbiddenException if caller has employee role only', async () => {
      await expect(
        service.createDesignation('org-1', 'Lead Engineer', mockEmployee),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException if title is empty', async () => {
      await expect(
        service.createDesignation('org-1', '   ', mockHr),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateDesignation', () => {
    it('updates title successfully', async () => {
      prismaMock.designation.findFirst
        .mockResolvedValueOnce({
          id: 'desig-1',
          title: 'Old Title',
          _count: { employees: 1 },
        })
        .mockResolvedValueOnce(null); // No duplicate

      prismaMock.designation.update.mockResolvedValue({
        id: 'desig-1',
        title: 'New Title',
        createdAt: new Date('2026-11-01T00:00:00Z'),
      });

      const result = await service.updateDesignation(
        'org-1',
        'desig-1',
        'New Title',
        mockAdmin,
      );

      expect(result.title).toBe('New Title');
    });

    it('throws NotFoundException if designation not found', async () => {
      prismaMock.designation.findFirst.mockResolvedValue(null);

      await expect(
        service.updateDesignation('org-1', 'missing', 'Title', mockHr),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException if title duplicate exists', async () => {
      prismaMock.designation.findFirst
        .mockResolvedValueOnce({
          id: 'desig-1',
          title: 'Old Title',
          _count: { employees: 0 },
        })
        .mockResolvedValueOnce({ id: 'desig-2', title: 'Existing Title' });

      await expect(
        service.updateDesignation('org-1', 'desig-1', 'Existing Title', mockAdmin),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('deleteDesignation', () => {
    it('archives designation when no active employees assigned', async () => {
      prismaMock.designation.findFirst.mockResolvedValue({
        id: 'desig-1',
        _count: { employees: 0 },
      });

      await service.deleteDesignation('org-1', 'desig-1', mockHr);

      expect(prismaMock.designation.update).toHaveBeenCalledWith({
        where: { id: 'desig-1' },
        data: expect.objectContaining({ archivedAt: expect.any(Date) }),
      });
    });

    it('throws ConflictException when active employees are assigned', async () => {
      prismaMock.designation.findFirst.mockResolvedValue({
        id: 'desig-1',
        _count: { employees: 3 },
      });

      await expect(
        service.deleteDesignation('org-1', 'desig-1', mockHr),
      ).rejects.toThrow(ConflictException);
    });
  });
});

