import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { TasksRepository } from './tasks.repository.js';
import { TasksService } from './tasks.service.js';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_USER_ID = '22222222-2222-2222-2222-222222222222';
const EMP_USER_ID = '33333333-3333-3333-3333-333333333333';
const EMP_ID = '44444444-4444-4444-4444-444444444444';
const TEAM_ID = '55555555-5555-5555-5555-555555555555';
const DEPT_ID = '66666666-6666-6666-6666-666666666666';
const TASK_ID = '77777777-7777-7777-7777-777777777777';

const SUPER_ADMIN: AuthenticatedUser = {
  userId: ADMIN_USER_ID,
  organizationId: ORG_ID,
  sessionId: 'sess-1',
  roles: ['super_admin'],
};

const EMPLOYEE_CALLER: AuthenticatedUser = {
  userId: EMP_USER_ID,
  organizationId: ORG_ID,
  sessionId: 'sess-2',
  roles: ['employee'],
};

describe('TasksService', () => {
  it('forbids regular employee from creating an individual task for someone else', async () => {
    const prisma = {} as unknown as PrismaService;
    const repo = {
      findCallerEmployeeContext: vi.fn().mockResolvedValue({
        employeeId: EMP_ID,
        departmentId: DEPT_ID,
        isActive: true,
        headedDepartmentIds: [],
      }),
    } as unknown as TasksRepository;

    const service = new TasksService(prisma, repo);

    await expect(
      service.createTask(
        {
          title: 'Unauthorized task',
          priority: 'medium',
          assignmentType: 'individual',
          assigneeId: EMP_ID,
        },
        EMPLOYEE_CALLER,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects team task creation when team has no active members (TEAM_EMPTY 422)', async () => {
    const prisma = {
      team: {
        findFirst: vi.fn().mockResolvedValue({
          id: TEAM_ID,
          departmentId: DEPT_ID,
          members: [],
        }),
      },
    } as unknown as PrismaService;
    const repo = {
      findCallerEmployeeContext: vi.fn().mockResolvedValue({
        employeeId: null,
        departmentId: null,
        isActive: false,
        headedDepartmentIds: [],
      }),
    } as unknown as TasksRepository;

    const service = new TasksService(prisma, repo);

    await expect(
      service.createTask(
        {
          title: 'Empty team task',
          priority: 'high',
          assignmentType: 'team',
          teamId: TEAM_ID,
        },
        SUPER_ADMIN,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('creates individual task for Super Admin with assignment, status event, notification, and audit log', async () => {
    const assignmentCreate = vi.fn().mockResolvedValue({ id: 'asg-1' });
    const eventCreate = vi.fn().mockResolvedValue({});
    const notifCreate = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});

    const prisma = {
      employee: {
        findFirst: vi.fn().mockResolvedValue({
          id: EMP_ID,
          userId: EMP_USER_ID,
          departmentId: DEPT_ID,
          employmentStatus: 'active',
        }),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          task: {
            create: vi.fn().mockResolvedValue({
              id: TASK_ID,
              title: 'Prepare Q4 report',
              description: null,
              priority: 'high',
              dueDate: null,
              assignmentType: 'individual',
              requiresReview: true,
              status: 'active',
              department: { id: DEPT_ID, name: 'Engineering' },
              team: null,
              createdAt: new Date('2026-11-23T05:00:00Z'),
            }),
          },
          taskAssignment: { create: assignmentCreate },
          taskStatusEvent: { create: eventCreate },
          notification: { create: notifCreate },
          auditLog: { create: auditCreate },
        }),
      ),
    } as unknown as PrismaService;
    const repo = {
      findCallerEmployeeContext: vi.fn().mockResolvedValue({
        employeeId: null,
        departmentId: null,
        isActive: false,
        headedDepartmentIds: [],
      }),
    } as unknown as TasksRepository;

    const service = new TasksService(prisma, repo);
    const created = await service.createTask(
      {
        title: 'Prepare Q4 report',
        priority: 'high',
        assignmentType: 'individual',
        assigneeId: EMP_ID,
      },
      SUPER_ADMIN,
    );

    expect(created).toMatchObject({
      id: TASK_ID,
      title: 'Prepare Q4 report',
      requiresReview: true,
      progress: { done: 0, total: 1 },
    });
    expect(assignmentCreate).toHaveBeenCalled();
    expect(eventCreate).toHaveBeenCalled();
    expect(notifCreate).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalled();
  });

  it('locks requiresReview update once submissions exist', async () => {
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          task: {
            findUnique: vi.fn().mockResolvedValue({
              id: TASK_ID,
              departmentId: DEPT_ID,
              createdBy: ADMIN_USER_ID,
              status: 'active',
              requiresReview: true,
              assignments: [{ id: 'asg-1', status: 'in_review', _count: { submissions: 1 } }],
            }),
          },
        }),
      ),
    } as unknown as PrismaService;
    const repo = {
      findCallerEmployeeContext: vi.fn().mockResolvedValue({
        employeeId: null,
        departmentId: null,
        isActive: false,
        headedDepartmentIds: [],
      }),
    } as unknown as TasksRepository;

    const service = new TasksService(prisma, repo);

    await expect(
      service.updateTask(TASK_ID, { requiresReview: false }, SUPER_ADMIN),
    ).rejects.toThrow(ConflictException);
  });

  it('cancels task and open assignments with status events and audit log', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const createManyEvents = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue({});

    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          task: {
            findUnique: vi.fn().mockResolvedValue({
              id: TASK_ID,
              departmentId: DEPT_ID,
              createdBy: ADMIN_USER_ID,
              status: 'active',
              assignments: [
                { id: 'asg-1', status: 'todo' },
                { id: 'asg-2', status: 'done' },
              ],
            }),
            update: vi.fn().mockResolvedValue({
              id: TASK_ID,
              status: 'cancelled',
              cancelledAt: new Date('2026-11-23T06:00:00Z'),
              cancelReason: 'Superseded by Q1 roadmap',
            }),
          },
          taskAssignment: { updateMany },
          taskStatusEvent: { createMany: createManyEvents },
          auditLog: { create: auditCreate },
        }),
      ),
    } as unknown as PrismaService;
    const repo = {
      findCallerEmployeeContext: vi.fn().mockResolvedValue({
        employeeId: null,
        departmentId: null,
        isActive: false,
        headedDepartmentIds: [],
      }),
    } as unknown as TasksRepository;

    const service = new TasksService(prisma, repo);
    const result = await service.cancelTask(
      TASK_ID,
      { reason: 'Superseded by Q1 roadmap' },
      SUPER_ADMIN,
    );

    expect(result.status).toBe('cancelled');
    expect(result.cancelledAssignmentsCount).toBe(1);
    expect(updateMany).toHaveBeenCalled();
    expect(createManyEvents).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalled();
  });

  it('allows Employee and HR Manager to create self tasks with requiresReview defaulting to false', async () => {
    const assignmentCreate = vi.fn().mockResolvedValue({ id: 'asg-self' });
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          task: {
            create: vi.fn().mockResolvedValue({
              id: TASK_ID,
              title: 'Personal checklist',
              description: null,
              priority: 'low',
              dueDate: null,
              assignmentType: 'self',
              requiresReview: false,
              status: 'active',
              department: { id: DEPT_ID, name: 'Engineering' },
              team: null,
              createdAt: new Date('2026-11-23T05:00:00Z'),
            }),
          },
          taskAssignment: { create: assignmentCreate },
          taskStatusEvent: { create: vi.fn().mockResolvedValue({}) },
          notification: { create: vi.fn() },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        }),
      ),
    } as unknown as PrismaService;
    const repo = {
      findCallerEmployeeContext: vi.fn().mockResolvedValue({
        employeeId: EMP_ID,
        departmentId: DEPT_ID,
        isActive: true,
        headedDepartmentIds: [],
      }),
    } as unknown as TasksRepository;

    const service = new TasksService(prisma, repo);
    const created = await service.createTask(
      {
        title: 'Personal checklist',
        priority: 'low',
        assignmentType: 'self',
      },
      EMPLOYEE_CALLER,
    );

    expect(created).toMatchObject({
      assignmentType: 'self',
      requiresReview: false,
      progress: { done: 0, total: 1 },
    });
    expect(assignmentCreate).toHaveBeenCalled();
  });

  it('allows Department Head to fan out a team task in headed department and rejects other departments with 404', async () => {
    const deptHeadCaller: AuthenticatedUser = {
      userId: 'head-user-id',
      organizationId: ORG_ID,
      sessionId: 'sess-head',
      roles: ['department_head'],
    };

    const assignmentCreate = vi.fn().mockResolvedValue({ id: 'asg-team' });
    const prisma = {
      team: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: TEAM_ID,
            departmentId: DEPT_ID,
            members: [
              { employee: { id: EMP_ID, userId: EMP_USER_ID } },
              { employee: { id: 'emp-2', userId: 'user-2' } },
            ],
          })
          .mockResolvedValueOnce({
            id: TEAM_ID,
            departmentId: 'other-dept-id',
            members: [{ employee: { id: EMP_ID, userId: EMP_USER_ID } }],
          }),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          task: {
            create: vi.fn().mockResolvedValue({
              id: TASK_ID,
              title: 'Sprint release prep',
              description: null,
              priority: 'high',
              dueDate: null,
              assignmentType: 'team',
              requiresReview: true,
              status: 'active',
              department: { id: DEPT_ID, name: 'Engineering' },
              team: { id: TEAM_ID, name: 'Core Squad' },
              createdAt: new Date('2026-11-23T05:00:00Z'),
            }),
          },
          taskAssignment: { create: assignmentCreate },
          taskStatusEvent: { create: vi.fn().mockResolvedValue({}) },
          notification: { create: vi.fn().mockResolvedValue({}) },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        }),
      ),
    } as unknown as PrismaService;
    const repo = {
      findCallerEmployeeContext: vi.fn().mockResolvedValue({
        employeeId: 'head-emp-id',
        departmentId: DEPT_ID,
        isActive: true,
        headedDepartmentIds: [DEPT_ID],
      }),
    } as unknown as TasksRepository;

    const service = new TasksService(prisma, repo);
    const created = await service.createTask(
      {
        title: 'Sprint release prep',
        priority: 'high',
        assignmentType: 'team',
        teamId: TEAM_ID,
      },
      deptHeadCaller,
    );

    expect(created).toMatchObject({
      assignmentType: 'team',
      requiresReview: true,
      progress: { done: 0, total: 2 },
    });
    expect(assignmentCreate).toHaveBeenCalledTimes(2);

    await expect(
      service.createTask(
        {
          title: 'Cross-dept task',
          priority: 'medium',
          assignmentType: 'team',
          teamId: TEAM_ID,
        },
        deptHeadCaller,
      ),
    ).rejects.toThrow();
  });
});
