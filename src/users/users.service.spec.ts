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
});
