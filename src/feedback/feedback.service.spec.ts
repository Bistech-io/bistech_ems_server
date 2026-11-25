import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import type { PrismaService } from '../database/prisma.service.js';
import { FeedbackService } from './feedback.service.js';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_EMP_ID = '22222222-2222-2222-2222-222222222222';
const USER_ADMIN_ID = '33333333-3333-3333-3333-333333333333';
const FEEDBACK_ID = '44444444-4444-4444-4444-444444444444';

const EMPLOYEE_CALLER: AuthenticatedUser = {
  userId: USER_EMP_ID,
  organizationId: ORG_ID,
  sessionId: 'sess-emp',
  roles: ['employee'],
};

const ADMIN_CALLER: AuthenticatedUser = {
  userId: USER_ADMIN_ID,
  organizationId: ORG_ID,
  sessionId: 'sess-admin',
  roles: ['super_admin'],
};

function makeFeedbackRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FEEDBACK_ID,
    organizationId: ORG_ID,
    submittedBy: USER_EMP_ID,
    isNotice: false,
    kind: 'issue',
    category: 'workplace',
    subject: 'AC temperature in Zone B',
    body: 'The cooling in Zone B has been off since morning.',
    status: 'open',
    resolutionNote: null,
    handledBy: null,
    handledAt: null,
    createdAt: new Date('2026-11-25T08:00:00Z'),
    updatedAt: new Date('2026-11-25T08:00:00Z'),
    submitter: {
      id: USER_EMP_ID,
      displayName: 'Ashikur Rahman',
      email: 'ashik@bistech.io',
    },
    handler: null,
    ...overrides,
  };
}

describe('FeedbackService', () => {
  it('allows any authenticated user to create an issue or suggestion with audit log', async () => {
    const createMock = vi.fn().mockResolvedValue(makeFeedbackRow());
    const auditMock = vi.fn().mockResolvedValue({});
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          feedbackItem: { create: createMock },
          auditLog: { create: auditMock },
        }),
      ),
    } as unknown as PrismaService;

    const service = new FeedbackService(prisma);
    const result = await service.createFeedback(
      {
        isNotice: false,
        kind: 'issue',
        category: 'workplace',
        subject: 'AC temperature in Zone B',
        body: 'The cooling in Zone B has been off since morning.',
      },
      EMPLOYEE_CALLER,
    );

    expect(result).toMatchObject({
      id: FEEDBACK_ID,
      organizationId: ORG_ID,
      kind: 'issue',
      status: 'open',
      submitter: {
        id: USER_EMP_ID,
        displayName: 'Ashikur Rahman',
        email: 'ashik@bistech.io',
      },
    });
    expect(createMock).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalled();
  });

  it('rejects reusing an Idempotency-Key with a different payload', async () => {
    const prisma = {
      idempotencyKey: {
        findUnique: vi.fn().mockResolvedValue({
          requestHash: 'different-hash',
          responseBody: {},
        }),
      },
    } as unknown as PrismaService;

    const service = new FeedbackService(prisma);

    await expect(
      service.createFeedback(
        {
          isNotice: false,
          kind: 'suggestion',
          category: 'general',
          subject: 'Add standing desks',
          body: 'Standing desks in the engineering area would help posture.',
        },
        EMPLOYEE_CALLER,
        'idem-key-1',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('lists all company-scoped issues and suggestions with author details for any role', async () => {
    const countMock = vi.fn().mockResolvedValue(1);
    const findManyMock = vi.fn().mockResolvedValue([makeFeedbackRow()]);
    const prisma = {
      feedbackItem: {
        count: countMock,
        findMany: findManyMock,
      },
    } as unknown as PrismaService;

    const service = new FeedbackService(prisma);
    const res = await service.listFeedback(EMPLOYEE_CALLER, {
      page: 1,
      limit: 20,
    });

    expect(countMock).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID },
    });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].submitter.displayName).toBe('Ashikur Rahman');
    expect(res.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it('throws 404 NotFoundException when feedback item is outside caller company or missing', async () => {
    const prisma = {
      feedbackItem: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaService;

    const service = new FeedbackService(prisma);

    await expect(service.getFeedbackById(FEEDBACK_ID, EMPLOYEE_CALLER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('allows super_admin to update status and rejects non-super_admin with 403', async () => {
    const updateMock = vi.fn().mockResolvedValue(
      makeFeedbackRow({
        status: 'resolved',
        resolutionNote: 'Technician fixed the AC unit.',
        handledBy: USER_ADMIN_ID,
        handledAt: new Date('2026-11-25T10:00:00Z'),
        handler: { id: USER_ADMIN_ID, displayName: 'BisTech Admin' },
      }),
    );
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          feedbackItem: {
            findFirst: vi.fn().mockResolvedValue(makeFeedbackRow()),
            update: updateMock,
          },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        }),
      ),
    } as unknown as PrismaService;

    const service = new FeedbackService(prisma);

    await expect(
      service.updateFeedback(FEEDBACK_ID, { status: 'resolved' }, EMPLOYEE_CALLER),
    ).rejects.toThrow(ForbiddenException);

    const updated = await service.updateFeedback(
      FEEDBACK_ID,
      { status: 'resolved', resolutionNote: 'Technician fixed the AC unit.' },
      ADMIN_CALLER,
    );

    expect(updated.status).toBe('resolved');
    expect(updated.resolutionNote).toBe('Technician fixed the AC unit.');
  });

  it('allows creator, super_admin, and hr_manager to delete feedback, and rejects others with 403', async () => {
    const deleteMock = vi.fn().mockResolvedValue({});
    const auditMock = vi.fn().mockResolvedValue({});
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          feedbackItem: {
            findFirst: vi.fn().mockResolvedValue(makeFeedbackRow()),
            delete: deleteMock,
          },
          auditLog: { create: auditMock },
        }),
      ),
    } as unknown as PrismaService;

    const service = new FeedbackService(prisma);

    const otherUser: AuthenticatedUser = {
      userId: '55555555-5555-5555-5555-555555555555',
      organizationId: ORG_ID,
      sessionId: 'sess-other',
      roles: ['department_head'],
    };

    await expect(service.deleteFeedback(FEEDBACK_ID, otherUser)).rejects.toThrow(
      ForbiddenException,
    );

    const hrCaller: AuthenticatedUser = {
      userId: '66666666-6666-6666-6666-666666666666',
      organizationId: ORG_ID,
      sessionId: 'sess-hr',
      roles: ['hr_manager'],
    };

    await expect(service.deleteFeedback(FEEDBACK_ID, EMPLOYEE_CALLER)).resolves.toEqual({
      id: FEEDBACK_ID,
    });
    await expect(service.deleteFeedback(FEEDBACK_ID, ADMIN_CALLER)).resolves.toEqual({
      id: FEEDBACK_ID,
    });
    await expect(service.deleteFeedback(FEEDBACK_ID, hrCaller)).resolves.toEqual({
      id: FEEDBACK_ID,
    });
    expect(deleteMock).toHaveBeenCalledTimes(3);
    expect(auditMock).toHaveBeenCalledTimes(3);
  });

  it('lists, creates, updates, and deletes feedback comments with proper authorization', async () => {
    const commentId = '77777777-7777-4777-8777-777777777777';
    const commentRow = {
      id: commentId,
      organizationId: ORG_ID,
      feedbackId: FEEDBACK_ID,
      authorUserId: USER_EMP_ID,
      body: 'We noticed the same issue on floor 2.',
      createdAt: new Date('2026-11-25T11:00:00Z'),
      updatedAt: new Date('2026-11-25T11:00:00Z'),
      author: {
        id: USER_EMP_ID,
        displayName: 'Ashikur Rahman',
        email: 'ashik@bistech.io',
      },
    };
    const otherUser: AuthenticatedUser = {
      userId: '55555555-5555-4555-8555-555555555555',
      organizationId: ORG_ID,
      sessionId: 'sess-other',
      roles: ['employee'],
    };

    const prisma = {
      feedbackItem: {
        findFirst: vi.fn().mockResolvedValue({ id: FEEDBACK_ID }),
      },
      feedbackComment: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([commentRow]),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          feedbackItem: {
            findFirst: vi.fn().mockResolvedValue({ id: FEEDBACK_ID }),
          },
          feedbackComment: {
            create: vi.fn().mockResolvedValue(commentRow),
            findFirst: vi.fn().mockResolvedValue(commentRow),
            update: vi.fn().mockResolvedValue({ ...commentRow, body: 'Updated comment' }),
            delete: vi.fn().mockResolvedValue({ id: commentId }),
          },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        }),
      ),
    } as unknown as PrismaService;

    const service = new FeedbackService(prisma);

    const listRes = await service.listComments(FEEDBACK_ID, otherUser, { page: 1, limit: 20 });
    expect(listRes.items).toHaveLength(1);
    expect(listRes.items[0].author.displayName).toBe('Ashikur Rahman');

    const created = await service.createComment(
      FEEDBACK_ID,
      { body: 'We noticed the same issue on floor 2.' },
      EMPLOYEE_CALLER,
    );
    expect(created.id).toBe(commentId);

    await expect(
      service.updateComment(FEEDBACK_ID, commentId, { body: 'Hijack' }, otherUser),
    ).rejects.toThrow(ForbiddenException);

    const updated = await service.updateComment(
      FEEDBACK_ID,
      commentId,
      { body: 'Updated comment' },
      EMPLOYEE_CALLER,
    );
    expect(updated.body).toBe('Updated comment');

    await expect(
      service.deleteComment(FEEDBACK_ID, commentId, otherUser),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      service.deleteComment(FEEDBACK_ID, commentId, EMPLOYEE_CALLER),
    ).resolves.toEqual({ id: commentId });
  });

  it('allows super_admin, hr_manager, and dept_head to post notices and rejects regular employees with 403', async () => {
    const createMock = vi.fn().mockResolvedValue(makeFeedbackRow({ isNotice: true }));
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          feedbackItem: { create: createMock },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        }),
      ),
    } as unknown as PrismaService;

    const service = new FeedbackService(prisma);
    const noticeDto = {
      isNotice: true,
      kind: 'suggestion' as const,
      category: 'general' as const,
      subject: 'Office Closed This Friday',
      body: 'All offices will be closed this Friday for annual maintenance.',
    };

    await expect(service.createFeedback(noticeDto, EMPLOYEE_CALLER)).rejects.toThrow(
      ForbiddenException,
    );

    const hrCaller: AuthenticatedUser = {
      userId: '55555555-5555-5555-5555-555555555555',
      organizationId: ORG_ID,
      sessionId: 'sess-hr',
      roles: ['hr_manager'],
    };
    const deptHeadCaller: AuthenticatedUser = {
      userId: '66666666-6666-6666-6666-666666666666',
      organizationId: ORG_ID,
      sessionId: 'sess-head',
      roles: ['dept_head'],
    };

    const adminRes = await service.createFeedback(noticeDto, ADMIN_CALLER);
    expect(adminRes).toMatchObject({ isNotice: true });

    const hrRes = await service.createFeedback(noticeDto, hrCaller);
    expect(hrRes).toMatchObject({ isNotice: true });

    const headRes = await service.createFeedback(noticeDto, deptHeadCaller);
    expect(headRes).toMatchObject({ isNotice: true });
  });
});
