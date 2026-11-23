import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  CreateCommentDto,
  CreateSubmissionDto,
  ListCommentsQueryDto,
  ListSubmissionsQueryDto,
  ReviewSubmissionDto,
  UpdateAssignmentStatusDto,
} from './dto/task-workflow.dto.js';
import {
  assertCanSubmitFromStatus,
  assertManualStatusTransition,
} from './task-state-machine.js';
import { TasksRepository } from './tasks.repository.js';

@Injectable()
export class TasksWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksRepo: TasksRepository,
  ) {}

  private hashPayload(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  async getAssignmentById(assignmentId: string, caller: AuthenticatedUser) {
    const orgId = caller.organizationId;
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isDeptHead = caller.roles.includes('department_head');
    const callerCtx = await this.tasksRepo.findCallerEmployeeContext(orgId, caller.userId);

    const assignment = await this.prisma.taskAssignment.findUnique({
      where: {
        organizationId_id: { organizationId: orgId, id: assignmentId },
      },
      include: {
        task: {
          include: {
            department: { select: { id: true, name: true } },
            team: { select: { id: true, name: true } },
            creator: { select: { id: true, displayName: true } },
          },
        },
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
          },
        },
        submissions: {
          orderBy: { version: 'desc' },
          include: {
            reviewer: { select: { id: true, displayName: true } },
          },
        },
        statusEvents: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: {
            actor: { select: { id: true, displayName: true } },
          },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Task assignment not found',
      });
    }

    const isAssignee = callerCtx.employeeId === assignment.employeeId;
    const isCreator = assignment.task.createdBy === caller.userId;
    const isManagedHead =
      isDeptHead && callerCtx.headedDepartmentIds.includes(assignment.task.departmentId);

    if (!isSuperAdmin && !isManagedHead && !isCreator && !isAssignee) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Task assignment not found',
      });
    }

    return {
      id: assignment.id,
      status: assignment.status,
      startedAt: assignment.startedAt ? assignment.startedAt.toISOString() : null,
      submittedAt: assignment.submittedAt ? assignment.submittedAt.toISOString() : null,
      completedAt: assignment.completedAt ? assignment.completedAt.toISOString() : null,
      employee: {
        id: assignment.employee.id,
        employeeCode: assignment.employee.employeeCode,
        fullName: `${assignment.employee.firstName} ${assignment.employee.lastName}`.trim(),
      },
      task: {
        id: assignment.task.id,
        title: assignment.task.title,
        description: assignment.task.description,
        priority: assignment.task.priority,
        dueDate: assignment.task.dueDate
          ? assignment.task.dueDate.toISOString().slice(0, 10)
          : null,
        assignmentType: assignment.task.assignmentType,
        requiresReview: assignment.task.requiresReview,
        status: assignment.task.status,
        department: assignment.task.department,
        team: assignment.task.team,
        creator: assignment.task.creator,
      },
      submissions: assignment.submissions.map((s) => ({
        id: s.id,
        version: s.version,
        note: s.note,
        links: s.links,
        reviewStatus: s.reviewStatus,
        submittedAt: s.submittedAt.toISOString(),
        reviewedAt: s.reviewedAt ? s.reviewedAt.toISOString() : null,
        reviewNote: s.reviewNote,
        reviewer: s.reviewer,
      })),
      timeline: assignment.statusEvents.map((e) => ({
        id: e.id,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actor: e.actor,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async updateAssignmentStatus(
    assignmentId: string,
    dto: UpdateAssignmentStatusDto,
    caller: AuthenticatedUser,
  ) {
    const orgId = caller.organizationId;
    const callerCtx = await this.tasksRepo.findCallerEmployeeContext(orgId, caller.userId);

    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.taskAssignment.findUnique({
        where: {
          organizationId_id: { organizationId: orgId, id: assignmentId },
        },
        include: {
          task: { select: { status: true } },
        },
      });

      if (
        !assignment ||
        (!caller.roles.includes('super_admin') &&
          callerCtx.employeeId !== assignment.employeeId)
      ) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Task assignment not found',
        });
      }

      if (assignment.task.status === 'cancelled') {
        throw new ConflictException({
          code: 'INVALID_TASK_TRANSITION',
          message: 'Cannot update status of a cancelled task',
        });
      }

      assertManualStatusTransition(assignment.status, dto.status);

      const now = new Date();
      const updated = await tx.taskAssignment.update({
        where: {
          organizationId_id: { organizationId: orgId, id: assignmentId },
        },
        data: {
          status: dto.status,
          startedAt:
            dto.status === 'in_progress' && !assignment.startedAt
              ? now
              : assignment.startedAt,
        },
      });

      await tx.taskStatusEvent.create({
        data: {
          organizationId: orgId,
          assignmentId: assignment.id,
          fromStatus: assignment.status,
          toStatus: dto.status,
          actorUserId: caller.userId,
        },
      });

      return {
        id: updated.id,
        status: updated.status,
        startedAt: updated.startedAt ? updated.startedAt.toISOString() : null,
        updatedAt: updated.updatedAt.toISOString(),
      };
    });
  }

  async submitAssignment(
    assignmentId: string,
    dto: CreateSubmissionDto,
    caller: AuthenticatedUser,
    idempotencyKey?: string,
  ) {
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

      if (existingKey && existingKey.expiresAt > new Date()) {
        if (existingKey.requestHash !== requestHash) {
          throw new UnprocessableEntityException({
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'Idempotency-Key reused with a different request payload',
          });
        }
        if (existingKey.responseBody) {
          return existingKey.responseBody;
        }
      }
    }

    const callerCtx = await this.tasksRepo.findCallerEmployeeContext(orgId, caller.userId);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM task_assignments
        WHERE id = ${assignmentId}::uuid AND organization_id = ${orgId}::uuid
        FOR UPDATE
      `;

      const assignment = await tx.taskAssignment.findUnique({
        where: {
          organizationId_id: { organizationId: orgId, id: assignmentId },
        },
        include: {
          task: {
            select: {
              id: true,
              title: true,
              status: true,
              requiresReview: true,
              departmentId: true,
              createdBy: true,
            },
          },
          submissions: {
            orderBy: { version: 'desc' },
            select: { id: true, version: true, reviewStatus: true },
          },
        },
      });

      if (
        !assignment ||
        (!caller.roles.includes('super_admin') &&
          callerCtx.employeeId !== assignment.employeeId)
      ) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Task assignment not found',
        });
      }

      if (assignment.task.status === 'cancelled') {
        throw new ConflictException({
          code: 'INVALID_TASK_TRANSITION',
          message: 'Cannot submit work for a cancelled task',
        });
      }

      assertCanSubmitFromStatus(assignment.status);

      const hasPending = assignment.submissions.some((s) => s.reviewStatus === 'pending');
      if (hasPending) {
        throw new ConflictException({
          code: 'PENDING_SUBMISSION_EXISTS',
          message: 'A pending submission already exists for this assignment',
        });
      }

      const nextVersion = (assignment.submissions[0]?.version ?? 0) + 1;
      const now = new Date();
      const targetStatus = assignment.task.requiresReview ? 'in_review' : 'done';
      const reviewStatus = assignment.task.requiresReview ? 'pending' : 'not_required';

      const submission = await tx.taskSubmission.create({
        data: {
          organizationId: orgId,
          assignmentId: assignment.id,
          version: nextVersion,
          note: dto.note,
          links: dto.links,
          submittedBy: caller.userId,
          reviewStatus,
        },
      });

      await tx.taskAssignment.update({
        where: {
          organizationId_id: { organizationId: orgId, id: assignment.id },
        },
        data: {
          status: targetStatus,
          submittedAt: now,
          completedAt: targetStatus === 'done' ? now : null,
        },
      });

      await tx.taskStatusEvent.create({
        data: {
          organizationId: orgId,
          assignmentId: assignment.id,
          fromStatus: assignment.status,
          toStatus: targetStatus,
          actorUserId: caller.userId,
        },
      });

      if (
        assignment.task.requiresReview &&
        assignment.task.createdBy !== caller.userId
      ) {
        await tx.notification.create({
          data: {
            organizationId: orgId,
            userId: assignment.task.createdBy,
            type: 'task.submitted',
            title: `Submission ready for review: ${assignment.task.title}`,
            body: `Version ${nextVersion} submitted`,
            payload: {
              taskId: assignment.task.id,
              assignmentId: assignment.id,
              submissionId: submission.id,
            },
            dedupeKey: `task.submitted:${submission.id}`,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: 'task.submitted',
          entityType: 'task_submission',
          entityId: submission.id,
          metadata: {
            assignmentId: assignment.id,
            version: nextVersion,
            reviewStatus,
          },
        },
      });

      const responseData = {
        id: submission.id,
        assignmentId: assignment.id,
        version: submission.version,
        note: submission.note,
        links: submission.links,
        reviewStatus: submission.reviewStatus,
        assignmentStatus: targetStatus,
        submittedAt: submission.submittedAt.toISOString(),
      };

      if (idempotencyKey) {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await tx.idempotencyKey.upsert({
          where: {
            organizationId_userId_key: {
              organizationId: orgId,
              userId: caller.userId,
              key: idempotencyKey,
            },
          },
          update: {
            requestHash,
            responseStatus: 201,
            responseBody: responseData,
            expiresAt,
          },
          create: {
            organizationId: orgId,
            userId: caller.userId,
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

  async listSubmissions(caller: AuthenticatedUser, query: ListSubmissionsQueryDto) {
    const orgId = caller.organizationId;
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isDeptHead = caller.roles.includes('department_head');

    if (!isSuperAdmin && !isDeptHead) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only Super Admins or Department Heads can access the review queue',
      });
    }

    const callerCtx = await this.tasksRepo.findCallerEmployeeContext(orgId, caller.userId);
    if (!isSuperAdmin && callerCtx.headedDepartmentIds.length === 0) {
      return {
        items: [],
        meta: { page: query.page, limit: query.limit, total: 0, totalPages: 0 },
      };
    }

    const where: Record<string, unknown> = {
      organizationId: orgId,
      ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      assignment: {
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.taskId ? { taskId: query.taskId } : {}),
        task: {
          ...(query.departmentId ? { departmentId: query.departmentId } : {}),
          ...(!isSuperAdmin
            ? { departmentId: { in: callerCtx.headedDepartmentIds } }
            : {}),
        },
      },
    };

    const skip = (query.page - 1) * query.limit;

    const [total, submissions] = await Promise.all([
      this.prisma.taskSubmission.count({ where }),
      this.prisma.taskSubmission.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ submittedAt: 'desc' }],
        include: {
          submitter: { select: { id: true, displayName: true } },
          reviewer: { select: { id: true, displayName: true } },
          assignment: {
            select: {
              id: true,
              status: true,
              employee: {
                select: {
                  id: true,
                  employeeCode: true,
                  firstName: true,
                  lastName: true,
                },
              },
              task: {
                select: {
                  id: true,
                  title: true,
                  priority: true,
                  department: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      items: submissions.map((s) => ({
        id: s.id,
        version: s.version,
        note: s.note,
        links: s.links,
        reviewStatus: s.reviewStatus,
        reviewNote: s.reviewNote,
        submittedAt: s.submittedAt.toISOString(),
        reviewedAt: s.reviewedAt ? s.reviewedAt.toISOString() : null,
        submitter: s.submitter,
        reviewer: s.reviewer,
        assignment: {
          id: s.assignment.id,
          status: s.assignment.status,
          employee: {
            id: s.assignment.employee.id,
            employeeCode: s.assignment.employee.employeeCode,
            fullName:
              `${s.assignment.employee.firstName} ${s.assignment.employee.lastName}`.trim(),
          },
          task: s.assignment.task,
        },
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async reviewSubmission(
    submissionId: string,
    dto: ReviewSubmissionDto,
    caller: AuthenticatedUser,
  ) {
    const orgId = caller.organizationId;
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isDeptHead = caller.roles.includes('department_head');

    if (!isSuperAdmin && !isDeptHead) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only Super Admins or Department Heads can review submissions',
      });
    }

    const callerCtx = await this.tasksRepo.findCallerEmployeeContext(orgId, caller.userId);

    return this.prisma.$transaction(async (tx) => {
      const submission = await tx.taskSubmission.findFirst({
        where: { id: submissionId, organizationId: orgId },
        include: {
          assignment: {
            select: {
              id: true,
              status: true,
              task: {
                select: {
                  id: true,
                  title: true,
                  departmentId: true,
                },
              },
            },
          },
        },
      });

      if (!submission) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Task submission not found',
        });
      }

      if (
        !isSuperAdmin &&
        !callerCtx.headedDepartmentIds.includes(submission.assignment.task.departmentId)
      ) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Task submission not found',
        });
      }

      if (submission.submittedBy === caller.userId) {
        throw new UnprocessableEntityException({
          code: 'SELF_REVIEW_NOT_ALLOWED',
          message: 'You cannot review your own submission',
        });
      }

      const now = new Date();
      const updateResult = await tx.taskSubmission.updateMany({
        where: {
          id: submissionId,
          organizationId: orgId,
          reviewStatus: 'pending',
        },
        data: {
          reviewStatus: dto.decision,
          reviewedBy: caller.userId,
          reviewedAt: now,
          reviewNote: dto.note ?? null,
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictException({
          code: 'ALREADY_REVIEWED',
          message: 'Submission has already been reviewed',
        });
      }

      const nextAssignmentStatus =
        dto.decision === 'approved' ? 'done' : 'changes_requested';

      await tx.taskAssignment.update({
        where: {
          organizationId_id: {
            organizationId: orgId,
            id: submission.assignment.id,
          },
        },
        data: {
          status: nextAssignmentStatus,
          completedAt: dto.decision === 'approved' ? now : null,
        },
      });

      await tx.taskStatusEvent.create({
        data: {
          organizationId: orgId,
          assignmentId: submission.assignment.id,
          fromStatus: submission.assignment.status,
          toStatus: nextAssignmentStatus,
          actorUserId: caller.userId,
        },
      });

      await tx.notification.create({
        data: {
          organizationId: orgId,
          userId: submission.submittedBy,
          type: 'task.reviewed',
          title:
            dto.decision === 'approved'
              ? `Submission approved: ${submission.assignment.task.title}`
              : `Changes requested: ${submission.assignment.task.title}`,
          body: dto.note ?? null,
          payload: {
            taskId: submission.assignment.task.id,
            assignmentId: submission.assignment.id,
            submissionId: submission.id,
            decision: dto.decision,
          },
          dedupeKey: `task.reviewed:${submission.id}`,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: 'task.reviewed',
          entityType: 'task_submission',
          entityId: submission.id,
          metadata: {
            assignmentId: submission.assignment.id,
            decision: dto.decision,
          },
        },
      });

      return {
        id: submission.id,
        assignmentId: submission.assignment.id,
        reviewStatus: dto.decision,
        assignmentStatus: nextAssignmentStatus,
        reviewedAt: now.toISOString(),
        reviewNote: dto.note ?? null,
      };
    });
  }

  private async assertCanActOnTask(taskId: string, caller: AuthenticatedUser) {
    const orgId = caller.organizationId;
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isDeptHead = caller.roles.includes('department_head');
    const callerCtx = await this.tasksRepo.findCallerEmployeeContext(orgId, caller.userId);

    const task = await this.prisma.task.findUnique({
      where: { organizationId_id: { organizationId: orgId, id: taskId } },
      include: {
        assignments: {
          where: { status: { not: 'cancelled' } },
          select: {
            employeeId: true,
            employee: { select: { userId: true } },
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Task not found',
      });
    }

    const isCreator = task.createdBy === caller.userId;
    const isAssignee =
      callerCtx.employeeId !== null &&
      task.assignments.some((a) => a.employeeId === callerCtx.employeeId);
    const isManagedHead =
      isDeptHead && callerCtx.headedDepartmentIds.includes(task.departmentId);

    // FSD T-17: Board-only viewers cannot read or post comments (404)
    if (!isSuperAdmin && !isManagedHead && !isCreator && !isAssignee) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Task not found',
      });
    }

    return task;
  }

  async listComments(
    taskId: string,
    caller: AuthenticatedUser,
    query: ListCommentsQueryDto,
  ) {
    await this.assertCanActOnTask(taskId, caller);

    const comments = await this.prisma.taskComment.findMany({
      where: {
        organizationId: caller.organizationId,
        taskId,
      },
      take: query.limit + 1,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        author: { select: { id: true, displayName: true, email: true } },
      },
    });

    const hasMore = comments.length > query.limit;
    const items = hasMore ? comments.slice(0, query.limit) : comments;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    return {
      items: items.map((c) => ({
        id: c.id,
        body: c.body,
        author: c.author,
        createdAt: c.createdAt.toISOString(),
      })),
      meta: {
        limit: query.limit,
        nextCursor,
        hasMore,
      },
    };
  }

  async createComment(
    taskId: string,
    dto: CreateCommentDto,
    caller: AuthenticatedUser,
  ) {
    const task = await this.assertCanActOnTask(taskId, caller);
    const orgId = caller.organizationId;

    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.taskComment.create({
        data: {
          organizationId: orgId,
          taskId: task.id,
          authorUserId: caller.userId,
          body: dto.body,
        },
        include: {
          author: { select: { id: true, displayName: true, email: true } },
        },
      });

      const recipientUserIds = new Set<string>();
      if (task.createdBy !== caller.userId) {
        recipientUserIds.add(task.createdBy);
      }
      for (const a of task.assignments) {
        if (a.employee.userId !== caller.userId) {
          recipientUserIds.add(a.employee.userId);
        }
      }

      if (recipientUserIds.size > 0) {
        await tx.notification.createMany({
          data: Array.from(recipientUserIds).map((uid) => ({
            organizationId: orgId,
            userId: uid,
            type: 'task.commented',
            title: `New comment on: ${task.title}`,
            body: dto.body.slice(0, 120),
            payload: { taskId: task.id, commentId: comment.id },
            dedupeKey: `task.commented:${comment.id}:${uid}`,
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: 'task.commented',
          entityType: 'task_comment',
          entityId: comment.id,
          metadata: { taskId: task.id },
        },
      });

      return {
        id: comment.id,
        taskId: comment.taskId,
        body: comment.body,
        author: comment.author,
        createdAt: comment.createdAt.toISOString(),
      };
    });
  }
}
