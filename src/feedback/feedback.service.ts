import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  CreateFeedbackDto,
  ListFeedbackQueryDto,
  UpdateFeedbackDto,
} from './dto/feedback.dto.js';

@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  private hashPayload(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private mapItem(item: {
    id: string;
    organizationId: string;
    kind: string;
    category: string;
    subject: string;
    body: string;
    status: string;
    resolutionNote: string | null;
    handledAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    submitter: { id: string; displayName: string; email: string };
    handler: { id: string; displayName: string } | null;
  }) {
    return {
      id: item.id,
      organizationId: item.organizationId,
      kind: item.kind,
      category: item.category,
      subject: item.subject,
      body: item.body,
      status: item.status,
      resolutionNote: item.resolutionNote,
      submitter: item.submitter,
      handler: item.handler,
      handledAt: item.handledAt ? item.handledAt.toISOString() : null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  async createFeedback(
    dto: CreateFeedbackDto,
    caller: AuthenticatedUser,
    idempotencyKey?: string,
  ) {
    const orgId = caller.organizationId;
    const requestHash = this.hashPayload(dto);

    if (idempotencyKey) {
      const existingKey = await this.prisma.idempotencyKey.findUnique({
        where: {
          organizationId_actorUserId_scope_key: {
            organizationId: orgId,
            actorUserId: caller.userId,
            scope: 'feedback.create',
            key: idempotencyKey,
          },
        },
      });

      if (existingKey) {
        if (existingKey.requestHash !== requestHash) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'Idempotency-Key already used with a different request payload',
          });
        }
        return existingKey.responseBody;
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.feedbackItem.create({
        data: {
          organizationId: orgId,
          submittedBy: caller.userId,
          kind: dto.kind,
          category: dto.category,
          subject: dto.subject,
          body: dto.body,
          status: 'open',
        },
        include: {
          submitter: { select: { id: true, displayName: true, email: true } },
          handler: { select: { id: true, displayName: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: 'feedback.submitted',
          entityType: 'feedback_item',
          entityId: created.id,
          metadata: {
            kind: dto.kind,
            category: dto.category,
          },
        },
      });

      const responseData = this.mapItem(created);

      if (idempotencyKey) {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await tx.idempotencyKey.create({
          data: {
            organizationId: orgId,
            actorUserId: caller.userId,
            scope: 'feedback.create',
            key: idempotencyKey,
            requestHash,
            responseStatus: 201,
            responseBody: responseData,
            expiresAt,
          },
        });
      }

      return responseData;
    });
  }

  async listFeedback(caller: AuthenticatedUser, query: ListFeedbackQueryDto) {
    const orgId = caller.organizationId;
    const where = {
      organizationId: orgId,
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const skip = (query.page - 1) * query.limit;

    const [total, rows] = await Promise.all([
      this.prisma.feedbackItem.count({ where }),
      this.prisma.feedbackItem.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ createdAt: 'desc' }],
        include: {
          submitter: { select: { id: true, displayName: true, email: true } },
          handler: { select: { id: true, displayName: true } },
        },
      }),
    ]);

    return {
      items: rows.map((row) => this.mapItem(row)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getFeedbackById(id: string, caller: AuthenticatedUser) {
    const item = await this.prisma.feedbackItem.findFirst({
      where: {
        id,
        organizationId: caller.organizationId,
      },
      include: {
        submitter: { select: { id: true, displayName: true, email: true } },
        handler: { select: { id: true, displayName: true } },
      },
    });

    if (!item) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Issue or suggestion not found',
      });
    }

    return this.mapItem(item);
  }

  async updateFeedback(
    id: string,
    dto: UpdateFeedbackDto,
    caller: AuthenticatedUser,
  ) {
    const isSuperAdmin = caller.roles.includes('super_admin');
    if (!isSuperAdmin) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only Super Admins can update issue or suggestion status',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.feedbackItem.findFirst({
        where: {
          id,
          organizationId: caller.organizationId,
        },
      });

      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Issue or suggestion not found',
        });
      }

      const updated = await tx.feedbackItem.update({
        where: { id: existing.id },
        data: {
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.resolutionNote !== undefined
            ? { resolutionNote: dto.resolutionNote }
            : {}),
          handledBy: caller.userId,
          handledAt: new Date(),
        },
        include: {
          submitter: { select: { id: true, displayName: true, email: true } },
          handler: { select: { id: true, displayName: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: caller.organizationId,
          actorUserId: caller.userId,
          action: 'feedback.updated',
          entityType: 'feedback_item',
          entityId: updated.id,
          metadata: {
            status: updated.status,
          },
        },
      });

      return this.mapItem(updated);
    });
  }

  async deleteFeedback(id: string, caller: AuthenticatedUser) {
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isHrManager = caller.roles.includes('hr_manager');

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.feedbackItem.findFirst({
        where: {
          id,
          organizationId: caller.organizationId,
        },
      });

      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Issue or suggestion not found',
        });
      }

      const isCreator = existing.submittedBy === caller.userId;
      if (!isCreator && !isSuperAdmin && !isHrManager) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message:
            'Only the creator, HR Managers, or Super Admins can delete an issue or suggestion',
        });
      }

      await tx.feedbackItem.delete({
        where: { id: existing.id },
      });

      await tx.auditLog.create({
        data: {
          organizationId: caller.organizationId,
          actorUserId: caller.userId,
          action: 'feedback.deleted',
          entityType: 'feedback_item',
          entityId: existing.id,
          metadata: {
            kind: existing.kind,
            submittedBy: existing.submittedBy,
          },
        },
      });

      return { id: existing.id };
    });
  }
}
