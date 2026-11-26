import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard.js';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter.js';
import { PrismaService } from '../database/prisma.service.js';
import { SubTasksController } from './sub-tasks.controller.js';
import { SubTasksService } from './sub-tasks.service.js';
import { TasksRepository } from './tasks.repository.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const CREATOR_USER_ID = '33333333-3333-4333-8333-333333333333';
const ASSIGNEE_USER_ID = '44444444-4444-4444-8444-444444444444';
const ASSIGNEE_EMP_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_USER_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_EMP_ID = '77777777-7777-4777-8777-777777777777';
const ADMIN_USER_ID = '88888888-8888-4888-8888-888888888888';
const DEPT_ID = '99999999-9999-4999-8999-999999999999';

const USERS: Record<string, { user: AuthenticatedUser; employeeId: string | null }> = {
  creator: {
    user: {
      userId: CREATOR_USER_ID,
      organizationId: ORG_ID,
      sessionId: 'sess-creator',
      roles: ['department_head'],
    },
    employeeId: null,
  },
  assignee: {
    user: {
      userId: ASSIGNEE_USER_ID,
      organizationId: ORG_ID,
      sessionId: 'sess-assignee',
      roles: ['employee'],
    },
    employeeId: ASSIGNEE_EMP_ID,
  },
  other: {
    user: {
      userId: OTHER_USER_ID,
      organizationId: ORG_ID,
      sessionId: 'sess-other',
      roles: ['employee'],
    },
    employeeId: OTHER_EMP_ID,
  },
  admin: {
    user: {
      userId: ADMIN_USER_ID,
      organizationId: ORG_ID,
      sessionId: 'sess-admin',
      roles: ['super_admin'],
    },
    employeeId: null,
  },
};

describe('SubTasks (HTTP & Service)', () => {
  let app: INestApplication;
  let storedSubTasks: Array<{
    id: string;
    organizationId: string;
    taskId: string;
    createdBy: string;
    title: string;
    description: string | null;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    creator: { id: string; displayName: string; email: string };
  }>;

  beforeEach(async () => {
    storedSubTasks = [];
    let seq = 0;

    const prismaMock = {
      task: {
        findUnique: vi.fn(async ({ where }: { where: { organizationId_id: { id: string; organizationId: string } } }) => {
          if (
            where.organizationId_id.id !== TASK_ID ||
            where.organizationId_id.organizationId !== ORG_ID
          ) {
            return null;
          }
          return {
            id: TASK_ID,
            departmentId: DEPT_ID,
            createdBy: CREATOR_USER_ID,
            assignments: [{ employeeId: ASSIGNEE_EMP_ID }],
          };
        }),
      },
      subTask: {
        findMany: vi.fn(async () => storedSubTasks),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          subTask: {
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
              seq += 1;
              const row = {
                id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${seq}`,
                organizationId: data.organizationId as string,
                taskId: data.taskId as string,
                createdBy: data.createdBy as string,
                title: data.title as string,
                description: (data.description as string | null) ?? null,
                status: data.status as 'PENDING' | 'IN_PROGRESS' | 'COMPLETED',
                completedAt: (data.completedAt as Date | null) ?? null,
                createdAt: new Date(`2026-11-26T0${seq}:00:00Z`),
                updatedAt: new Date(`2026-11-26T0${seq}:00:00Z`),
                creator: {
                  id: data.createdBy as string,
                  displayName: 'Task User',
                  email: 'user@bistech.io',
                },
              };
              storedSubTasks.push(row);
              return row;
            }),
            findMany: vi.fn(async () =>
              storedSubTasks.map((s) => ({ status: s.status })),
            ),
            findFirst: vi.fn(
              async ({
                where,
              }: {
                where: { id: string; taskId: string; organizationId: string };
              }) =>
                storedSubTasks.find(
                  (s) =>
                    s.id === where.id &&
                    s.taskId === where.taskId &&
                    s.organizationId === where.organizationId,
                ) ?? null,
            ),
            update: vi.fn(
              async ({
                where,
                data,
              }: {
                where: { id: string };
                data: Record<string, unknown>;
              }) => {
                const row = storedSubTasks.find((s) => s.id === where.id)!;
                Object.assign(row, data, { updatedAt: new Date('2026-11-26T10:00:00Z') });
                return row;
              },
            ),
            delete: vi.fn(async ({ where }: { where: { id: string } }) => {
              storedSubTasks = storedSubTasks.filter((s) => s.id !== where.id);
              return { id: where.id };
            }),
          },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        }),
      ),
    } as unknown as PrismaService;

    const repoMock = {
      findCallerEmployeeContext: vi.fn(async (_orgId: string, userId: string) => {
        const entry = Object.values(USERS).find((u) => u.user.userId === userId);
        return {
          employeeId: entry?.employeeId ?? null,
          departmentId: DEPT_ID,
          isActive: true,
          headedDepartmentIds: [],
        };
      }),
    } as unknown as TasksRepository;

    const mockGuard: CanActivate = {
      canActivate(ctx: ExecutionContext) {
        const req = ctx.switchToHttp().getRequest();
        const roleKey = (req.headers['x-test-actor'] as string) || 'assignee';
        req.user = (USERS[roleKey] ?? USERS.assignee).user;
        return true;
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [SubTasksController],
      providers: [
        SubTasksService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: TasksRepository, useValue: repoMock },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue(mockGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows creator and assignee to create, list, update, and delete sub-tasks with live progress percentage', async () => {
    // Creator creates sub-task 1 (PENDING)
    const create1 = await request(app.getHttpServer())
      .post(`/api/v1/tasks/${TASK_ID}/sub-tasks`)
      .set('x-test-actor', 'creator')
      .send({ title: 'Design schema', description: 'Add sub_tasks table' })
      .expect(201);

    expect(create1.body.success).toBe(true);
    expect(create1.body.data.status).toBe('PENDING');
    expect(create1.body.data.progress).toEqual({
      total: 1,
      completed: 0,
      inProgress: 0,
      pending: 1,
      completionPercentage: 0,
    });

    // Assignee creates sub-task 2 (IN_PROGRESS)
    const create2 = await request(app.getHttpServer())
      .post(`/api/v1/tasks/${TASK_ID}/sub-tasks`)
      .set('x-test-actor', 'assignee')
      .send({ title: 'Write unit tests', status: 'IN_PROGRESS' })
      .expect(201);

    const subTask1Id = create1.body.data.id as string;
    const subTask2Id = create2.body.data.id as string;

    // Assignee marks sub-task 1 COMPLETED -> 50% progress
    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/tasks/${TASK_ID}/sub-tasks/${subTask1Id}`)
      .set('x-test-actor', 'assignee')
      .send({ status: 'COMPLETED' })
      .expect(200);

    expect(patchRes.body.data.status).toBe('COMPLETED');
    expect(patchRes.body.data.completedAt).toBeTruthy();
    expect(patchRes.body.data.progress).toEqual({
      total: 2,
      completed: 1,
      inProgress: 1,
      pending: 0,
      completionPercentage: 50,
    });

    // List sub-tasks
    const listRes = await request(app.getHttpServer())
      .get(`/api/v1/tasks/${TASK_ID}/sub-tasks`)
      .set('x-test-actor', 'creator')
      .expect(200);

    expect(listRes.body.data.items).toHaveLength(2);
    expect(listRes.body.data.progress.completionPercentage).toBe(50);

    // Creator deletes sub-task 2 -> 100% progress (1/1 completed)
    const delRes = await request(app.getHttpServer())
      .delete(`/api/v1/tasks/${TASK_ID}/sub-tasks/${subTask2Id}`)
      .set('x-test-actor', 'creator')
      .expect(200);

    expect(delRes.body.data.id).toBe(subTask2Id);
    expect(delRes.body.data.progress).toEqual({
      total: 1,
      completed: 1,
      inProgress: 0,
      pending: 0,
      completionPercentage: 100,
    });
  });

  it('rejects unauthorized users with 403, missing tasks with 404, and invalid payloads with 400', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/tasks/${TASK_ID}/sub-tasks`)
      .set('x-test-actor', 'other')
      .send({ title: 'Unauthorized sub-task' })
      .expect(403);

    await request(app.getHttpServer())
      .get(`/api/v1/tasks/${TASK_ID}/sub-tasks`)
      .set('x-test-actor', 'other')
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/tasks/11111111-1111-4111-8111-000000000000/sub-tasks')
      .set('x-test-actor', 'admin')
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/tasks/${TASK_ID}/sub-tasks`)
      .set('x-test-actor', 'admin')
      .send({ title: '' })
      .expect(400);
  });
});
