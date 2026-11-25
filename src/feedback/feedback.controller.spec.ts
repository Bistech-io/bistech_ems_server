import { type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard.js';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter.js';
import { PrismaService } from '../database/prisma.service.js';
import { FeedbackController } from './feedback.controller.js';
import { FeedbackService } from './feedback.service.js';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const EMP_USER_ID = '22222222-2222-2222-2222-222222222222';
const HR_USER_ID = '33333333-3333-3333-3333-333333333333';
const ADMIN_USER_ID = '44444444-4444-4444-4444-444444444444';
const OTHER_USER_ID = '55555555-5555-5555-5555-555555555555';
const FEEDBACK_ID = '66666666-6666-4666-8666-666666666666';

const USERS_BY_ROLE: Record<string, AuthenticatedUser> = {
  employee: {
    userId: EMP_USER_ID,
    organizationId: ORG_ID,
    sessionId: 'sess-emp',
    roles: ['employee'],
  },
  hr_manager: {
    userId: HR_USER_ID,
    organizationId: ORG_ID,
    sessionId: 'sess-hr',
    roles: ['hr_manager'],
  },
  super_admin: {
    userId: ADMIN_USER_ID,
    organizationId: ORG_ID,
    sessionId: 'sess-admin',
    roles: ['super_admin'],
  },
  other_dept_head: {
    userId: OTHER_USER_ID,
    organizationId: ORG_ID,
    sessionId: 'sess-head',
    roles: ['department_head'],
  },
};

describe('FeedbackController (HTTP)', () => {
  let app: INestApplication;
  let storedRows: Array<Record<string, unknown>>;

  beforeEach(async () => {
    storedRows = [
      {
        id: FEEDBACK_ID,
        organizationId: ORG_ID,
        submittedBy: EMP_USER_ID,
        kind: 'issue',
        category: 'workplace',
        subject: 'WiFi drops on 3rd floor',
        body: 'The WiFi disconnects every 20 minutes near meeting room B.',
        status: 'open',
        resolutionNote: null,
        handledBy: null,
        handledAt: null,
        createdAt: new Date('2026-11-25T08:00:00Z'),
        updatedAt: new Date('2026-11-25T08:00:00Z'),
        submitter: {
          id: EMP_USER_ID,
          displayName: 'Ashikur Rahman',
          email: 'ashik@bistech.io',
        },
        handler: null,
      },
    ];

    const prismaMock = {
      idempotencyKey: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      feedbackItem: {
        count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          storedRows.filter(
            (r) =>
              r.organizationId === where.organizationId &&
              (!where.kind || r.kind === where.kind),
          ).length,
        ),
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          storedRows.filter(
            (r) =>
              r.organizationId === where.organizationId &&
              (!where.kind || r.kind === where.kind),
          ),
        ),
        findFirst: vi.fn(
          async ({ where }: { where: { id: string; organizationId: string } }) =>
            storedRows.find(
              (r) => r.id === where.id && r.organizationId === where.organizationId,
            ) ?? null,
        ),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          feedbackItem: {
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
              const row = {
                id: '77777777-7777-7777-7777-777777777777',
                organizationId: data.organizationId,
                submittedBy: data.submittedBy,
                kind: data.kind,
                category: data.category,
                subject: data.subject,
                body: data.body,
                status: 'open',
                resolutionNote: null,
                handledBy: null,
                handledAt: null,
                createdAt: new Date('2026-11-25T09:00:00Z'),
                updatedAt: new Date('2026-11-25T09:00:00Z'),
                submitter: {
                  id: data.submittedBy,
                  displayName: 'Test Author',
                  email: 'author@bistech.io',
                },
                handler: null,
              };
              storedRows.push(row);
              return row;
            }),
            findFirst: vi.fn(
              async ({ where }: { where: { id: string; organizationId: string } }) =>
                storedRows.find(
                  (r) => r.id === where.id && r.organizationId === where.organizationId,
                ) ?? null,
            ),
            update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
              const row = storedRows.find((r) => r.id === where.id)!;
              Object.assign(row, data, {
                handler: { id: ADMIN_USER_ID, displayName: 'BisTech Admin' },
                updatedAt: new Date('2026-11-25T10:00:00Z'),
              });
              return row;
            }),
            delete: vi.fn(async ({ where }: { where: { id: string } }) => {
              storedRows = storedRows.filter((r) => r.id !== where.id);
              return { id: where.id };
            }),
          },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
          idempotencyKey: { create: vi.fn().mockResolvedValue({}) },
        }),
      ),
    };

    const mockGuard: CanActivate = {
      canActivate(ctx: ExecutionContext) {
        const req = ctx.switchToHttp().getRequest();
        const roleHeader = (req.headers['x-test-role'] as string) || 'employee';
        req.user = USERS_BY_ROLE[roleHeader] ?? USERS_BY_ROLE.employee;
        return true;
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [FeedbackController],
      providers: [
        FeedbackService,
        { provide: PrismaService, useValue: prismaMock },
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

  it('POST /api/v1/feedback creates an issue or suggestion and rejects invalid payloads with 400', async () => {
    const badRes = await request(app.getHttpServer())
      .post('/api/v1/feedback')
      .set('x-test-role', 'employee')
      .send({ kind: 'issue', subject: 'Hi', body: 'short' })
      .expect(400);

    expect(badRes.body.success).toBe(false);
    expect(badRes.body.error.code).toBe('VALIDATION_ERROR');

    const okRes = await request(app.getHttpServer())
      .post('/api/v1/feedback')
      .set('x-test-role', 'other_dept_head')
      .send({
        kind: 'suggestion',
        category: 'general',
        subject: 'Add dual monitors',
        body: 'Dual monitors would improve productivity for frontend and QA teams.',
      })
      .expect(201);

    expect(okRes.body.success).toBe(true);
    expect(okRes.body.data.kind).toBe('suggestion');
    expect(okRes.body.data.submitter.displayName).toBe('Test Author');
  });

  it('GET /api/v1/feedback and GET /api/v1/feedback/:id return company-wide items with author details', async () => {
    const listRes = await request(app.getHttpServer())
      .get('/api/v1/feedback?kind=issue')
      .set('x-test-role', 'employee')
      .expect(200);

    expect(listRes.body.success).toBe(true);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].submitter.displayName).toBe('Ashikur Rahman');
    expect(listRes.body.meta.total).toBe(1);

    const detailRes = await request(app.getHttpServer())
      .get(`/api/v1/feedback/${FEEDBACK_ID}`)
      .set('x-test-role', 'hr_manager')
      .expect(200);

    expect(detailRes.body.success).toBe(true);
    expect(detailRes.body.data.id).toBe(FEEDBACK_ID);

    await request(app.getHttpServer())
      .get('/api/v1/feedback/not-a-uuid')
      .expect(400);
  });

  it('PATCH /api/v1/feedback/:id allows super_admin (200) and rejects employee (403)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/feedback/${FEEDBACK_ID}`)
      .set('x-test-role', 'employee')
      .send({ status: 'resolved' })
      .expect(403);

    const okRes = await request(app.getHttpServer())
      .patch(`/api/v1/feedback/${FEEDBACK_ID}`)
      .set('x-test-role', 'super_admin')
      .send({ status: 'resolved', resolutionNote: 'Router replaced' })
      .expect(200);

    expect(okRes.body.success).toBe(true);
    expect(okRes.body.data.status).toBe('resolved');
  });

  it('DELETE /api/v1/feedback/:id allows creator, super_admin, and hr_manager, and rejects non-creator dept_head (403)', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/feedback/${FEEDBACK_ID}`)
      .set('x-test-role', 'other_dept_head')
      .expect(403);

    const delRes = await request(app.getHttpServer())
      .delete(`/api/v1/feedback/${FEEDBACK_ID}`)
      .set('x-test-role', 'hr_manager')
      .expect(200);

    expect(delRes.body.success).toBe(true);
    expect(delRes.body.data.id).toBe(FEEDBACK_ID);

    await request(app.getHttpServer())
      .get(`/api/v1/feedback/${FEEDBACK_ID}`)
      .set('x-test-role', 'employee')
      .expect(404);
  });
});
