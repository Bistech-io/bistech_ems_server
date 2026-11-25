import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DepartmentsService } from './departments.service.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';

describe('DepartmentsService', () => {
  let service: DepartmentsService;
  let prismaMock: any;

  const mockAdmin: AuthenticatedUser = {
    userId: '11111111-1111-1111-1111-111111111111',
    organizationId: 'org-1',
    sessionId: 'session-1',
    roles: ['super_admin'],
  };

  const mockHr: AuthenticatedUser = {
    userId: '22222222-2222-2222-2222-222222222222',
    organizationId: 'org-1',
    sessionId: 'session-2',
    roles: ['hr_manager'],
  };

  const mockEmployee: AuthenticatedUser = {
    userId: '33333333-3333-3333-3333-333333333333',
    organizationId: 'org-1',
    sessionId: 'session-3',
    roles: ['employee'],
  };

  beforeEach(() => {
    prismaMock = {
      department: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      designation: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      employee: {
        findFirst: vi.fn(),
      },
      role: {
        findFirst: vi.fn(),
      },
      userRole: {
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $queryRaw: vi.fn(),
      $transaction: vi.fn((cb: any) => cb(prismaMock)),
    };

    service = new DepartmentsService(prismaMock as unknown as PrismaService);
  });

  describe('listDepartments', () => {
    it('returns formatted departments with active employee counts and head', async () => {
      prismaMock.department.findMany.mockResolvedValue([
        {
          id: 'dept-1',
          name: 'Engineering',
          description: 'Tech squad',
          headEmployeeId: 'emp-1',
          headEmployee: {
            id: 'emp-1',
            firstName: 'Farhan',
            lastName: 'Ahmed',
            employeeCode: 'BST-1002',
          },
          _count: { employees: 5 },
          createdAt: new Date('2026-11-20T00:00:00Z'),
        },
      ]);

      const result = await service.listDepartments('org-1');
      expect(result).toEqual([
        {
          id: 'dept-1',
          name: 'Engineering',
          description: 'Tech squad',
          headEmployeeId: 'emp-1',
          headEmployee: {
            id: 'emp-1',
            name: 'Farhan Ahmed',
            employeeCode: 'BST-1002',
          },
          activeEmployeeCount: 5,
          createdAt: new Date('2026-11-20T00:00:00Z'),
        },
      ]);
    });

    it('falls back to active employee with dept_head role when headEmployeeId is null', async () => {
      prismaMock.department.findMany.mockResolvedValue([
        {
          id: 'dept-demo',
          name: 'Demo Department',
          description: null,
          headEmployeeId: null,
          headEmployee: null,
          employees: [
            {
              id: 'emp-demo-head',
              firstName: 'Demo',
              lastName: 'Dept Head',
              employeeCode: 'BST-1017',
            },
          ],
          _count: { employees: 3 },
          createdAt: new Date('2026-11-25T00:00:00Z'),
        },
      ]);

      const result = await service.listDepartments('org-1');

      expect(result).toHaveLength(1);
      expect(result[0].headEmployeeId).toBe('emp-demo-head');
      expect(result[0].headEmployee).toEqual({
        id: 'emp-demo-head',
        name: 'Demo Dept Head',
        employeeCode: 'BST-1017',
      });
    });
  });

  describe('createDepartment', () => {
    it('forbids normal employees from creating department', async () => {
      await expect(
        service.createDepartment('org-1', { name: 'DevOps' }, mockEmployee),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates a new department when name is unique', async () => {
      prismaMock.department.findFirst.mockResolvedValue(null);
      prismaMock.department.create.mockResolvedValue({
        id: 'dept-new',
        name: 'DevOps',
        description: 'Infra squad',
        createdAt: new Date('2026-11-23T00:00:00Z'),
      });

      const res = await service.createDepartment(
        'org-1',
        { name: 'DevOps', description: 'Infra squad' },
        mockHr,
      );

      expect(res.name).toBe('DevOps');
      expect(prismaMock.auditLog.create).toHaveBeenCalled();
    });

    it('throws ConflictException when active department with same name exists', async () => {
      prismaMock.department.findFirst.mockResolvedValue({
        id: 'dept-exist',
        name: 'Engineering',
        archivedAt: null,
      });

      await expect(
        service.createDepartment('org-1', { name: 'Engineering' }, mockAdmin),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateDepartment', () => {
    it('updates department name and description', async () => {
      prismaMock.department.findFirst
        .mockResolvedValueOnce({
          id: 'dept-1',
          name: 'Old Name',
          description: 'Old desc',
          headEmployeeId: null,
          headEmployee: null,
          _count: { employees: 2 },
        })
        .mockResolvedValueOnce(null); // No duplicate

      prismaMock.department.update.mockResolvedValue({
        id: 'dept-1',
        name: 'New Name',
        description: 'New desc',
        headEmployeeId: null,
        headEmployee: null,
        createdAt: new Date('2026-11-01T00:00:00Z'),
      });

      const res = await service.updateDepartment(
        'org-1',
        'dept-1',
        { name: 'New Name', description: 'New desc' },
        mockAdmin,
      );

      expect(res.name).toBe('New Name');
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'department.updated' }),
        }),
      );
    });
  });

  describe('deleteDepartment', () => {
    it('throws ConflictException if department still has active employees', async () => {
      prismaMock.department.findFirst.mockResolvedValue({
        id: 'dept-1',
        _count: { employees: 2 },
      });

      await expect(
        service.deleteDepartment('org-1', 'dept-1', mockHr),
      ).rejects.toThrow(ConflictException);
    });

    it('archives department when active employees is 0', async () => {
      prismaMock.department.findFirst.mockResolvedValue({
        id: 'dept-1',
        headEmployeeId: null,
        _count: { employees: 0 },
      });

      await service.deleteDepartment('org-1', 'dept-1', mockAdmin);
      expect(prismaMock.department.update).toHaveBeenCalledWith({
        where: { id: 'dept-1' },
        data: expect.objectContaining({ headEmployeeId: null }),
      });
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'department.archived' }),
        }),
      );
    });
  });

  describe('assignDepartmentHead', () => {
    const deptId = '22222222-2222-2222-2222-222222222222';
    const empId = '44444444-4444-4444-4444-444444444444';
    const userId = '55555555-5555-5555-5555-555555555555';

    it('forbids HR manager from assigning head (super admin only)', async () => {
      await expect(
        service.assignDepartmentHead(deptId, { employeeId: empId }, mockHr),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException if target employee is inactive', async () => {
      prismaMock.department.findFirst.mockResolvedValue({
        id: deptId,
        headEmployeeId: null,
      });
      prismaMock.employee.findFirst.mockResolvedValue({
        id: empId,
        userId,
        employmentStatus: 'inactive',
      });

      await expect(
        service.assignDepartmentHead(deptId, { employeeId: empId }, mockAdmin),
      ).rejects.toThrow(BadRequestException);
    });

    it('assigns department head and upserts department_head role in user_roles', async () => {
      prismaMock.department.findFirst.mockResolvedValue({
        id: deptId,
        name: 'Engineering',
        headEmployeeId: null,
        headEmployee: null,
      });
      prismaMock.employee.findFirst.mockResolvedValue({
        id: empId,
        userId,
        employmentStatus: 'active',
      });
      prismaMock.role.findFirst.mockResolvedValue({ id: 'role-dh-id' });
      prismaMock.department.update.mockResolvedValue({
        id: deptId,
        name: 'Engineering',
        description: 'Core Engineering',
        headEmployeeId: empId,
        headEmployee: {
          id: empId,
          firstName: 'Farhan',
          lastName: 'Ahmed',
          employeeCode: 'BST-1002',
        },
      });

      const res = await service.assignDepartmentHead(
        deptId,
        { employeeId: empId },
        mockAdmin,
      );

      expect(res.headEmployeeId).toBe(empId);
      expect(prismaMock.userRole.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_roleId: {
              userId,
              roleId: 'role-dh-id',
            },
          },
        }),
      );
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'department.head.assigned' }),
        }),
      );
    });

    it('clears department head and revokes department_head role if employee heads no other department', async () => {
      const oldEmpId = 'old-emp';
      const oldUserId = 'old-user';

      prismaMock.department.findFirst.mockResolvedValue({
        id: deptId,
        name: 'Engineering',
        headEmployeeId: oldEmpId,
        headEmployee: { id: oldEmpId, userId: oldUserId },
      });
      prismaMock.role.findFirst.mockResolvedValue({ id: 'role-dh-id' });
      prismaMock.department.count.mockResolvedValue(0); // heads no other dept
      prismaMock.department.update.mockResolvedValue({
        id: deptId,
        name: 'Engineering',
        description: 'Core Engineering',
        headEmployeeId: null,
        headEmployee: null,
      });

      const res = await service.assignDepartmentHead(
        deptId,
        { employeeId: null },
        mockAdmin,
      );

      expect(res.headEmployeeId).toBeNull();
      expect(prismaMock.userRole.deleteMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          userId: oldUserId,
          roleId: 'role-dh-id',
        },
      });
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'department.head.removed' }),
        }),
      );
    });
  });

  describe('Designations CRUD', () => {
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

      expect(result.title).toBe('Junior Software Developer');
    });

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
  });
});
