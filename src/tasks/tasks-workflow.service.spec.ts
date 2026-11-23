import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import type { PrismaService } from '../database/prisma.service.js';
import { createSubmissionSchema } from './dto/task-workflow.dto.js';
import { TasksWorkflowService } from './tasks-workflow.service.js';
import type { TasksRepository } from './tasks.repository.js';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_USER_ID = '22222222-2222-2222-2222-222222222222';
const EMP_USER_ID = '33333333-3333-3333-3333-333333333333';
const EMP_ID = '44444444-4444-4444-4444-444444444444';
const DEPT_ID = '55555555-5555-5555-5555-555555555555';
const TASK_ID = '66666666-6666-6666-6666-666666666666';
const ASG_ID = '77777777-7777-7777-7777-777777777777';
const SUB_ID = '88888888-8888-8888-8888-888888888888';

const EMPLOYEE_CALLER: AuthenticatedUser = {
  userId: EMP_USER_ID,
  organizationId: ORG_ID,
  sessionId: 'sess-emp',
  roles: ['employee'],
};

const ADMIN_CALLER: AuthenticatedUser = {
  userId: ADMIN_USER_ID,
  organizationId: ORG_ID,
  sessionId: 'sess-admin',
  roles: ['super_admin'],
};

describe('TasksWorkflowService', () => {
  it('rejects non-https / javascript: links in submission schema (T-28)', () => {
    expect(
      createSubmissionSchema.safeParse({
        note: 'Done',
        links: ['javascript:alert(1)'],
      }).success,
    ).toBe(false);

    expect(
      createSubmissionSchema.safeParse({
        note: 'Done',
        links: ['https://github.com/Bistech-io/bistech_ems/pull/1'],
      }).success,
    ).toBe(true);
  });

  it('blocks self-review with 422 SELF_REVIEW_NOT_ALLOWED (T-18)', async () => {
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          taskSubmission: {
            findFirst: vi.fn().mockResolvedValue({
              id: SUB_ID,
              submittedBy: ADMIN_USER_ID,
              assignment: {
                id: ASG_ID,
                status: 'in_review',
                task: { id: TASK_ID, title: 'Task A', departmentId: DEPT_ID },
              },
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

    const service = new TasksWorkflowService(prisma, repo);

    await expect(
      service.reviewSubmission(SUB_ID, { decision: 'approved' }, ADMIN_CALLER),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('throws 409 ALREADY_REVIEWED when atomic conditional update matches 0 rows (T-46)', async () => {
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          taskSubmission: {
            findFirst: vi.fn().mockResolvedValue({
              id: SUB_ID,
              submittedBy: EMP_USER_ID,
              assignment: {
                id: ASG_ID,
                status: 'in_review',
                task: { id: TASK_ID, title: 'Task A', departmentId: DEPT_ID },
              },
            }),
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
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

    const service = new TasksWorkflowService(prisma, repo);

    await expect(
      service.reviewSubmission(SUB_ID, { decision: 'approved' }, ADMIN_CALLER),
    ).rejects.toThrow(ConflictException);
  });

  it('approves pending submission, marks assignment done, appends event, notifies, and audits', async () => {
    const assignmentUpdate = vi.fn().mockResolvedValue({});
    const eventCreate = vi.fn().mockResolvedValue({});
    const notifCreate = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});

    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          taskSubmission: {
            findFirst: vi.fn().mockResolvedValue({
              id: SUB_ID,
              submittedBy: EMP_USER_ID,
              assignment: {
                id: ASG_ID,
                status: 'in_review',
                task: { id: TASK_ID, title: 'Task A', departmentId: DEPT_ID },
              },
            }),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          taskAssignment: { update: assignmentUpdate },
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

    const service = new TasksWorkflowService(prisma, repo);
    const res = await service.reviewSubmission(
      SUB_ID,
      { decision: 'approved', note: 'Looks good' },
      ADMIN_CALLER,
    );

    expect(res.reviewStatus).toBe('approved');
    expect(res.assignmentStatus).toBe('done');
    expect(assignmentUpdate).toHaveBeenCalled();
    expect(eventCreate).toHaveBeenCalled();
    expect(notifCreate).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalled();
  });

  it('hides task comments from board-only viewers with 404 NOT_FOUND (T-17)', async () => {
    const prisma = {
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: TASK_ID,
          departmentId: DEPT_ID,
          createdBy: ADMIN_USER_ID,
          assignments: [
            {
              employeeId: 'another-emp-id',
              employee: { userId: 'another-user-id' },
            },
          ],
        }),
      },
    } as unknown as PrismaService;
    const repo = {
      findCallerEmployeeContext: vi.fn().mockResolvedValue({
        employeeId: EMP_ID,
        departmentId: DEPT_ID,
        isActive: true,
        headedDepartmentIds: [],
      }),
    } as unknown as TasksRepository;

    const service = new TasksWorkflowService(prisma, repo);

    await expect(
      service.listComments(TASK_ID, EMPLOYEE_CALLER, { limit: 20 }),
    ).rejects.toThrow(NotFoundException);
  });
});
