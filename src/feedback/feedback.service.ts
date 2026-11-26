import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { hasPermission } from '../auth/permission.utils.js';
import { isDepartmentHeadRole } from '../auth/role.utils.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  CreateFeedbackCommentDto,
  CreateFeedbackDto,
  ListFeedbackCommentsQueryDto,
  ListFeedbackQueryDto,
  UpdateFeedbackCommentDto,
  UpdateFeedbackDto,
} from './dto/feedback.dto.js';

@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  private hashPayload(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private canPostNotice(caller: AuthenticatedUser): boolean {
    return (
      caller.roles.includes('super_admin') ||
      caller.roles.includes('hr_manager') ||
      isDepartmentHeadRole(caller.roles) ||
      hasPermission(caller, 'feedback.manage', 'org')
    );
  }

  private mapItem(item: {
    id: string;
    organizationId: string;
    isNotice?: boolean;
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
    _count?: { comments: number };
  }) {
    return {
      id: item.id,
      organizationId: item.organizationId,
      isNotice: Boolean(item.isNotice),
      kind: item.kind,
      category: item.category,
      subject: item.subject,
      body: item.body,
      status: item.status,
      resolutionNote: item.resolutionNote,
      commentCount: item._count?.comments ?? 0,
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
    const isNotice = Boolean(dto.isNotice);
    if (isNotice && !this.canPostNotice(caller)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only Super Admins, HR Managers, or Department Heads can post a notice',
      });
    }

    const orgId = caller.organizationId;
    const requestHash = this.hashPayload(dto);

    if (idempotencyKey) {
      const existingKey = await this.prisma.idempotencyKey.findUnique({
        where: {
          organizationId_userId_key: {
            organizationId: orgId,
            userId: caller.userId,
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
          isNotice,
          kind: dto.kind ?? 'suggestion',
          category: dto.category,
          subject: dto.subject,
          body: dto.body,
          status: 'open',
        },
        include: {
          submitter: { select: { id: true, displayName: true, email: true } },
          handler: { select: { id: true, displayName: true } },
          _count: { select: { comments: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: isNotice ? 'board.notice_posted' : 'feedback.submitted',
          entityType: 'feedback_item',
          entityId: created.id,
          metadata: {
            isNotice,
            kind: dto.kind ?? 'suggestion',
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
            userId: caller.userId,
            key: idempotencyKey,
            requestHash,
            responseStatus: 201,
            responseBody: responseData as object,
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
      ...(query.isNotice !== undefined ? { isNotice: query.isNotice } : {}),
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
        orderBy: [{ isNotice: 'desc' }, { createdAt: 'desc' }],
        include: {
          submitter: { select: { id: true, displayName: true, email: true } },
          handler: { select: { id: true, displayName: true } },
          _count: { select: { comments: true } },
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
        _count: { select: { comments: true } },
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
    const canManageFeedback =
      caller.roles.includes('super_admin') ||
      (!caller.roles.includes('hr_manager') &&
        hasPermission(caller, 'feedback.manage', 'org'));
    if (!canManageFeedback) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to update issue or suggestion status',
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
    const canManageFeedback = hasPermission(caller, 'feedback.manage', 'org');

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
      if (!isCreator && !canManageFeedback) {
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

  private mapComment(comment: {
    id: string;
    feedbackId: string;
    body: string;
    createdAt: Date;
    updatedAt: Date;
    author: { id: string; displayName: string; email: string };
  }) {
    return {
      id: comment.id,
      feedbackId: comment.feedbackId,
      body: comment.body,
      author: comment.author,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
    };
  }

  async listComments(
    feedbackId: string,
    caller: AuthenticatedUser,
    query: ListFeedbackCommentsQueryDto,
  ) {
    const feedback = await this.prisma.feedbackItem.findFirst({
      where: {
        id: feedbackId,
        organizationId: caller.organizationId,
      },
      select: { id: true },
    });

    if (!feedback) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Issue or suggestion not found',
      });
    }

    const where = {
      organizationId: caller.organizationId,
      feedbackId: feedback.id,
    };
    const skip = (query.page - 1) * query.limit;

    const [total, rows] = await Promise.all([
      this.prisma.feedbackComment.count({ where }),
      this.prisma.feedbackComment.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          author: { select: { id: true, displayName: true, email: true } },
        },
      }),
    ]);

    return {
      items: rows.map((row) => this.mapComment(row)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async createComment(
    feedbackId: string,
    dto: CreateFeedbackCommentDto,
    caller: AuthenticatedUser,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const feedback = await tx.feedbackItem.findFirst({
        where: {
          id: feedbackId,
          organizationId: caller.organizationId,
        },
        select: { id: true },
      });

      if (!feedback) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Issue or suggestion not found',
        });
      }

      const comment = await tx.feedbackComment.create({
        data: {
          organizationId: caller.organizationId,
          feedbackId: feedback.id,
          authorUserId: caller.userId,
          body: dto.body,
        },
        include: {
          author: { select: { id: true, displayName: true, email: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: caller.organizationId,
          actorUserId: caller.userId,
          action: 'feedback.commented',
          entityType: 'feedback_comment',
          entityId: comment.id,
          metadata: { feedbackId: feedback.id },
        },
      });

      return this.mapComment(comment);
    });
  }

  async updateComment(
    feedbackId: string,
    commentId: string,
    dto: UpdateFeedbackCommentDto,
    caller: AuthenticatedUser,
  ) {
    const canModerateFeedback =
      caller.roles.includes('super_admin') ||
      hasPermission(caller, 'feedback.manage', 'org');

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.feedbackComment.findFirst({
        where: {
          id: commentId,
          feedbackId,
          organizationId: caller.organizationId,
        },
      });

      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        });
      }

      const isAuthor = existing.authorUserId === caller.userId;
      if (!isAuthor && !canModerateFeedback) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Only the comment author or Super Admins can edit this comment',
        });
      }

      const updated = await tx.feedbackComment.update({
        where: { id: existing.id },
        data: { body: dto.body },
        include: {
          author: { select: { id: true, displayName: true, email: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: caller.organizationId,
          actorUserId: caller.userId,
          action: 'feedback.comment_updated',
          entityType: 'feedback_comment',
          entityId: updated.id,
          metadata: { feedbackId },
        },
      });

      return this.mapComment(updated);
    });
  }

  async deleteComment(
    feedbackId: string,
    commentId: string,
    caller: AuthenticatedUser,
  ) {
    const canManageFeedback = hasPermission(caller, 'feedback.manage', 'org');

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.feedbackComment.findFirst({
        where: {
          id: commentId,
          feedbackId,
          organizationId: caller.organizationId,
        },
      });

      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Comment not found',
        });
      }

      const isAuthor = existing.authorUserId === caller.userId;
      if (!isAuthor && !canManageFeedback) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message:
            'Only the comment author, HR Managers, or Super Admins can delete this comment',
        });
      }

      await tx.feedbackComment.delete({
        where: { id: existing.id },
      });

      await tx.auditLog.create({
        data: {
          organizationId: caller.organizationId,
          actorUserId: caller.userId,
          action: 'feedback.comment_deleted',
          entityType: 'feedback_comment',
          entityId: existing.id,
          metadata: { feedbackId, authorUserId: existing.authorUserId },
        },
      });

      return { id: existing.id };
    });
  }
}
