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
