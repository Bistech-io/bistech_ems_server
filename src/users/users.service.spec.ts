import { ConflictException, ForbiddenException } from '@nestjs/common';
import { vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import type { PrismaService } from '../database/prisma.service.js';
import { UsersService } from './users.service.js';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_ID = '22222222-2222-2222-2222-222222222222';
const TARGET_USER_ID = '33333333-3333-3333-3333-333333333333';

const SUPER_ADMIN: AuthenticatedUser = {
  userId: ADMIN_ID,
  organizationId: ORG_ID,
  sessionId: 'sess-1',
  roles: ['super_admin'],
};

const EMPLOYEE_CALLER: AuthenticatedUser = {
  userId: TARGET_USER_ID,
  organizationId: ORG_ID,
  sessionId: 'sess-2',
  roles: ['employee'],
};

describe('UsersService', () => {
  it('forbids regular employees from listing users', async () => {
    const prisma = {} as unknown as PrismaService;
    const service = new UsersService(prisma);

    await expect(
      service.listUsers(EMPLOYEE_CALLER, { page: 1, limit: 20 }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('prevents Super Admin from modifying own roles (SELF_MODIFICATION_NOT_ALLOWED)', async () => {
    const prisma = {} as unknown as PrismaService;
    const service = new UsersService(prisma);

    await expect(
      service.updateUserRoles(ADMIN_ID, { roles: ['employee'] }, SUPER_ADMIN),
    ).rejects.toThrow(ForbiddenException);
  });

  it('protects last active Super Admin (LAST_SUPER_ADMIN 409)', async () => {
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          user: {
            findUnique: vi.fn().mockResolvedValue({
              id: TARGET_USER_ID,
              email: 'admin2@bistech.io',
              displayName: 'Admin Two',
              accountStatus: 'active',
              userRoles: [{ role: { id: 'r-sa', name: 'super_admin' } }],
            }),
          },
          userRole: {
            count: vi.fn().mockResolvedValue(0),
          },
        }),
      ),
    } as unknown as PrismaService;

    const service = new UsersService(prisma);

    await expect(
      service.updateUserRoles(TARGET_USER_ID, { roles: ['hr_manager'] }, SUPER_ADMIN),
    ).rejects.toThrow(ConflictException);
  });

  it('replaces user roles and writes audit log when Super Admin promotes employee to HR Manager', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const auditCreate = vi.fn().mockResolvedValue({});

    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          user: {
            findUnique: vi.fn().mockResolvedValue({
              id: TARGET_USER_ID,
              email: 'nadia@bistech.io',
              displayName: 'Nadia Rahman',
              accountStatus: 'active',
              userRoles: [{ role: { id: 'r-emp', name: 'employee' } }],
            }),
          },
          role: {
            findMany: vi.fn().mockResolvedValue([
              { id: 'r-emp', name: 'employee' },
              { id: 'r-hr', name: 'hr_manager' },
            ]),
          },
          userRole: { deleteMany, createMany },
          auditLog: { create: auditCreate },
        }),
      ),
    } as unknown as PrismaService;

    const service = new UsersService(prisma);
    const updated = await service.updateUserRoles(
      TARGET_USER_ID,
      { roles: ['employee', 'hr_manager'] },
      SUPER_ADMIN,
    );

    expect(updated.roles).toEqual(['employee', 'hr_manager']);
    expect(deleteMany).toHaveBeenCalled();
    expect(createMany).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        organizationId: ORG_ID,
        actorUserId: ADMIN_ID,
        action: 'user.roles.updated',
        entityType: 'user',
        entityId: TARGET_USER_ID,
        metadata: {
          previousRoles: ['employee'],
          newRoles: ['employee', 'hr_manager'],
        },
      },
    });
  });

  it('maps department_head alias to DB dept_head role and syncs department head_employee_id', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const auditCreate = vi.fn().mockResolvedValue({});
    const deptUpdate = vi.fn().mockResolvedValue({});

    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          user: {
            findUnique: vi.fn().mockResolvedValue({
              id: TARGET_USER_ID,
              email: 'head2@bistech.io',
              displayName: 'Demo Dept Head',
              accountStatus: 'active',
              userRoles: [{ role: { id: 'r-emp', name: 'employee' } }],
            }),
          },
          role: {
            findMany: vi.fn().mockResolvedValue([
              { id: 'r-emp', name: 'employee' },
              { id: 'r-dh', name: 'dept_head' },
            ]),
          },
          userRole: { deleteMany, createMany },
          employee: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'emp-head-2',
              departmentId: 'dept-demo',
            }),
          },
          department: {
            findMany: vi.fn().mockResolvedValue([]),
            findFirst: vi.fn().mockResolvedValue({
              id: 'dept-demo',
              headEmployeeId: null,
              headEmployee: null,
            }),
            update: deptUpdate,
          },
          auditLog: { create: auditCreate },
        }),
      ),
    } as unknown as PrismaService;

    const service = new UsersService(prisma);
    const updated = await service.updateUserRoles(
      TARGET_USER_ID,
      { roles: ['employee', 'department_head'] },
      SUPER_ADMIN,
    );

    expect(updated.roles).toEqual(['employee', 'dept_head']);
    expect(createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ roleId: 'r-dh', userId: TARGET_USER_ID }),
      ]),
    });
    expect(deptUpdate).toHaveBeenCalledWith({
      where: {
        organizationId_id: {
          organizationId: ORG_ID,
          id: 'dept-demo',
        },
      },
      data: { headEmployeeId: 'emp-head-2' },
    });
  });

  it('clears department head_employee_id when dept_head role is removed from user', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue({});
    const deptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });

    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          user: {
            findUnique: vi.fn().mockResolvedValue({
              id: TARGET_USER_ID,
              email: 'head2@bistech.io',
              displayName: 'Demo Dept Head',
              accountStatus: 'active',
              userRoles: [
                { role: { id: 'r-emp', name: 'employee' } },
                { role: { id: 'r-dh', name: 'dept_head' } },
              ],
            }),
          },
          role: {
            findMany: vi.fn().mockResolvedValue([{ id: 'r-emp', name: 'employee' }]),
          },
          userRole: { deleteMany, createMany },
          employee: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'emp-head-2',
              departmentId: 'dept-demo',
            }),
          },
          department: {
            updateMany: deptUpdateMany,
          },
          auditLog: { create: auditCreate },
        }),
      ),
    } as unknown as PrismaService;

    const service = new UsersService(prisma);
    const updated = await service.updateUserRoles(
      TARGET_USER_ID,
      { roles: ['employee'] },
      SUPER_ADMIN,
    );

    expect(updated.roles).toEqual(['employee']);
    expect(deptUpdateMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        archivedAt: null,
        headEmployeeId: 'emp-head-2',
      },
      data: { headEmployeeId: null },
    });
  });

  it('lists roles with granted permissions and user counts', async () => {
    const prisma = {
      role: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'role-custom',
            name: 'finance_auditor',
            description: 'Audits attendance and logs',
            isSystem: false,
            createdAt: new Date('2026-11-25T10:00:00Z'),
            _count: { userRoles: 2 },
            rolePermissions: [
              {
                scope: 'org',
                permission: { key: 'audit.read', description: 'Read system audit logs' },
              },
            ],
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new UsersService(prisma);
    const result = await service.listRoles(SUPER_ADMIN);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'role-custom',
      name: 'finance_auditor',
      description: 'Audits attendance and logs',
      isSystem: false,
      userCount: 2,
      _count: { userRoles: 2 },
      permissions: [
        { key: 'audit.read', description: 'Read system audit logs', scope: 'org' },
      ],
    });
  });

  it('allows a custom role with user.read:org permission to list users', async () => {
    const prisma = {
      user: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: TARGET_USER_ID,
            username: 'alice',
            email: 'alice@bistech.io',
            displayName: 'Alice',
            accountStatus: 'active',
            lastLoginAt: null,
            createdAt: new Date('2026-11-25T10:00:00Z'),
            userRoles: [{ role: { id: 'r-auditor', name: 'finance_auditor' } }],
            employee: null,
          },
        ]),
      },
    } as unknown as PrismaService;

    const customAuditor: AuthenticatedUser = {
      userId: '44444444-4444-4444-4444-444444444444',
      organizationId: ORG_ID,
      sessionId: 'sess-auditor',
      roles: ['finance_auditor'],
      permissions: { 'user.read': 'org' },
    };

    const service = new UsersService(prisma);
    const res = await service.listUsers(customAuditor, { page: 1, limit: 20 });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].roles).toEqual(['finance_auditor']);
  });

  it('creates, updates, and deletes a custom role while protecting system roles', async () => {
    const roleCreate = vi.fn().mockResolvedValue({ id: 'role-new' });
    const rpCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue({});
    const roleFindUniqueOrThrow = vi.fn().mockResolvedValue({
      id: 'role-new',
      name: 'finance_auditor',
      description: 'Audits records',
      isSystem: false,
      createdAt: new Date('2026-11-25T10:00:00Z'),
      _count: { userRoles: 0 },
      rolePermissions: [
        {
          scope: 'org',
          permission: { key: 'audit.read', description: 'Read system audit logs' },
        },
      ],
    });

    const prisma = {
      role: {
        findUnique: vi.fn().mockResolvedValueOnce(null),
      },
      permission: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'perm-audit', key: 'audit.read' },
        ]),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          role: {
            create: roleCreate,
            findUniqueOrThrow: roleFindUniqueOrThrow,
          },
          rolePermission: { createMany: rpCreateMany },
          auditLog: { create: auditCreate },
        }),
      ),
    } as unknown as PrismaService;

    const service = new UsersService(prisma);
    const created = await service.createRole(
      {
        name: 'finance_auditor',
        description: 'Audits records',
        permissions: [{ key: 'audit.read', scope: 'org' }],
      },
      SUPER_ADMIN,
    );

    expect(created.name).toBe('finance_auditor');
    expect(created.isSystem).toBe(false);
    expect(created.permissions).toEqual([
      { key: 'audit.read', description: 'Read system audit logs', scope: 'org' },
    ]);

    const sysRolePrisma = {
      role: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'role-sys',
          name: 'super_admin',
          isSystem: true,
        }),
      },
    } as unknown as PrismaService;
    const sysService = new UsersService(sysRolePrisma);

    await expect(
      sysService.updateRole(
        'role-sys',
        { description: 'Changed' },
        SUPER_ADMIN,
      ),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      sysService.deleteRole('role-sys', SUPER_ADMIN),
    ).rejects.toThrow(ForbiddenException);
  });

  it('detaches custom role users safely on delete and preserves baseline employee role', async () => {
    const deleteUserRoles = vi.fn().mockResolvedValue({ count: 1 });
    const createUserRole = vi.fn().mockResolvedValue({});
    const deleteRole = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});

    const prisma = {
      role: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'role-custom',
          name: 'temp_reviewer',
          isSystem: false,
        }),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          userRole: {
            findMany: vi.fn().mockResolvedValue([{ userId: TARGET_USER_ID }]),
            deleteMany: deleteUserRoles,
            count: vi.fn().mockResolvedValue(0),
            create: createUserRole,
          },
          role: {
            findUnique: vi.fn().mockResolvedValue({ id: 'role-emp' }),
            delete: deleteRole,
          },
          auditLog: { create: auditCreate },
        }),
      ),
    } as unknown as PrismaService;

    const service = new UsersService(prisma);
    const result = await service.deleteRole('role-custom', SUPER_ADMIN);

    expect(result).toEqual({
      id: 'role-custom',
      name: 'temp_reviewer',
      detachedUsersCount: 1,
    });
    expect(createUserRole).toHaveBeenCalledWith({
      data: {
        organizationId: ORG_ID,
        userId: TARGET_USER_ID,
        roleId: 'role-emp',
        assignedBy: ADMIN_ID,
      },
    });
    expect(deleteRole).toHaveBeenCalledWith({ where: { id: 'role-custom' } });
  });
});
