import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import type { PrismaService } from '../database/prisma.service.js';
import { TeamsService } from './teams.service.js';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const DEPT_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_DEPT_ID = '33333333-3333-3333-3333-333333333333';
const EMP_ID = '44444444-4444-4444-4444-444444444444';
const TEAM_ID = '55555555-5555-5555-5555-555555555555';

const DEPT_HEAD: AuthenticatedUser = {
  userId: 'head-user-id',
  organizationId: ORG_ID,
  sessionId: 'sess-head',
  roles: ['department_head'],
};

const EMPLOYEE: AuthenticatedUser = {
  userId: 'emp-user-id',
  organizationId: ORG_ID,
  sessionId: 'sess-emp',
  roles: ['employee'],
};

describe('TeamsService', () => {
  it('forbids regular employees from creating teams', async () => {
    const prisma = {} as unknown as PrismaService;
    const service = new TeamsService(prisma);

    await expect(
      service.createTeam(
        { departmentId: DEPT_ID, name: 'Core Squad', memberIds: [] },
        EMPLOYEE,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('returns 404 when Department Head creates a team in a department they do not head (T-42)', async () => {
    const prisma = {
      employee: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'head-emp-id',
          departmentsHeaded: [{ id: DEPT_ID }],
        }),
      },
    } as unknown as PrismaService;
    const service = new TeamsService(prisma);

    await expect(
      service.createTeam(
        { departmentId: OTHER_DEPT_ID, name: 'Other Squad', memberIds: [] },
        DEPT_HEAD,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects cross-department members with 422 INVALID_TEAM_MEMBERS (T-42)', async () => {
    const prisma = {
      employee: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'head-emp-id',
          departmentsHeaded: [{ id: DEPT_ID }],
        }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: EMP_ID,
            userId: 'emp-user-id',
            departmentId: OTHER_DEPT_ID,
            employmentStatus: 'active',
          },
        ]),
      },
      department: {
        findFirst: vi.fn().mockResolvedValue({ id: DEPT_ID, name: 'Engineering' }),
      },
    } as unknown as PrismaService;
    const service = new TeamsService(prisma);

    await expect(
      service.createTeam(
        { departmentId: DEPT_ID, name: 'Core Squad', memberIds: [EMP_ID] },
        DEPT_HEAD,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('allows Department Head to create team with active same-dept members, notify, and audit', async () => {
    const createMembers = vi.fn().mockResolvedValue({ count: 1 });
    const createNotifs = vi.fn().mockResolvedValue({ count: 1 });
    const createAudit = vi.fn().mockResolvedValue({});

    const prisma = {
      employee: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'head-emp-id',
          departmentsHeaded: [{ id: DEPT_ID }],
        }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: EMP_ID,
            userId: 'emp-user-id',
            departmentId: DEPT_ID,
            employmentStatus: 'active',
          },
        ]),
      },
      department: {
        findFirst: vi.fn().mockResolvedValue({ id: DEPT_ID, name: 'Engineering' }),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          team: {
            create: vi.fn().mockResolvedValue({
              id: TEAM_ID,
              name: 'Core Squad',
              description: 'Platform team',
              department: { id: DEPT_ID, name: 'Engineering' },
              createdAt: new Date('2026-11-23T09:00:00Z'),
            }),
          },
          teamMember: { createMany: createMembers },
          notification: { createMany: createNotifs },
          auditLog: { create: createAudit },
        }),
      ),
    } as unknown as PrismaService;

    const service = new TeamsService(prisma);
    const created = await service.createTeam(
      {
        departmentId: DEPT_ID,
        name: 'Core Squad',
        description: 'Platform team',
        memberIds: [EMP_ID],
      },
      DEPT_HEAD,
    );

    expect(created).toMatchObject({
      id: TEAM_ID,
      name: 'Core Squad',
      memberCount: 1,
    });
    expect(createMembers).toHaveBeenCalled();
    expect(createNotifs).toHaveBeenCalled();
    expect(createAudit).toHaveBeenCalled();
  });
});
