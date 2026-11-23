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
  CancelTaskDto,
  CreateTaskDto,
  ListTasksQueryDto,
  UpdateTaskDto,
} from './dto/task.dto.js';
import type {
  DepartmentBoardQueryDto,
  MyTasksQueryDto,
  TeamBoardQueryDto,
} from './dto/task-board.dto.js';
import { TasksRepository } from './tasks.repository.js';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksRepo: TasksRepository,
  ) {}

  private hashPayload(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private computeProgress(assignments: { status: string }[]) {
    const active = assignments.filter((a) => a.status !== 'cancelled');
    const done = active.filter((a) => a.status === 'done').length;
    return { done, total: active.length };
  }

  async createTask(
    dto: CreateTaskDto,
    caller: AuthenticatedUser,
    idempotencyKey?: string,
  ) {
    const orgId = caller.organizationId;
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isDeptHead = caller.roles.includes('department_head');
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

    let departmentId: string;
    let teamId: string | null = null;
    let requiresReview: boolean;
    let assignees: { employeeId: string; userId: string }[] = [];

    if (dto.assignmentType === 'self') {
      if (!callerCtx.employeeId || !callerCtx.departmentId || !callerCtx.isActive) {
        throw new UnprocessableEntityException({
          code: 'ASSIGNEE_INACTIVE',
          message: 'Active employee profile is required to create a self task',
        });
      }
      departmentId = callerCtx.departmentId;
      requiresReview = dto.requiresReview ?? false;
      assignees = [{ employeeId: callerCtx.employeeId, userId: caller.userId }];
    } else if (dto.assignmentType === 'individual') {
      if (!isSuperAdmin && !isDeptHead) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Only Super Admins or Department Heads can assign tasks to individuals',
        });
      }

      const targetEmp = await this.prisma.employee.findFirst({
        where: { organizationId: orgId, id: dto.assigneeId! },
        select: {
          id: true,
          userId: true,
          departmentId: true,
          employmentStatus: true,
        },
      });

      if (!targetEmp) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Assignee employee not found',
        });
      }
      if (!isSuperAdmin && !callerCtx.headedDepartmentIds.includes(targetEmp.departmentId)) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Assignee employee not found',
        });
      }
      if (targetEmp.employmentStatus !== 'active') {
        throw new UnprocessableEntityException({
          code: 'ASSIGNEE_INACTIVE',
          message: 'Cannot assign task to an inactive employee',
        });
      }

      departmentId = targetEmp.departmentId;
      requiresReview = dto.requiresReview ?? true;
      assignees = [{ employeeId: targetEmp.id, userId: targetEmp.userId }];
    } else {
      if (!isSuperAdmin && !isDeptHead) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Only Super Admins or Department Heads can assign tasks to teams',
        });
      }

      const team = await this.prisma.team.findFirst({
        where: {
          organizationId: orgId,
          id: dto.teamId!,
          archivedAt: null,
        },
        select: {
          id: true,
          departmentId: true,
          members: {
            where: {
              removedAt: null,
              employee: { employmentStatus: 'active' },
            },
            select: {
              employee: { select: { id: true, userId: true } },
            },
          },
        },
      });

      if (!team) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Team not found',
        });
      }
      if (!isSuperAdmin && !callerCtx.headedDepartmentIds.includes(team.departmentId)) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Team not found',
        });
      }
      if (team.members.length === 0) {
        throw new UnprocessableEntityException({
          code: 'TEAM_EMPTY',
          message: 'Cannot assign task to an empty team',
        });
      }

      departmentId = team.departmentId;
      teamId = team.id;
      requiresReview = dto.requiresReview ?? true;
      assignees = team.members.map((m) => ({
        employeeId: m.employee.id,
        userId: m.employee.userId,
      }));
    }

    const createdTask = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          organizationId: orgId,
          title: dto.title,
          description: dto.description ?? null,
          priority: dto.priority,
          dueDate: dto.dueDate ? new Date(`${dto.dueDate}T00:00:00Z`) : null,
          assignmentType: dto.assignmentType,
          teamId,
          departmentId,
          requiresReview,
          status: 'active',
          createdBy: caller.userId,
        },
        include: {
          department: { select: { id: true, name: true } },
          team: { select: { id: true, name: true } },
        },
      });

      for (const assignee of assignees) {
        const assignment = await tx.taskAssignment.create({
          data: {
            organizationId: orgId,
            taskId: task.id,
            employeeId: assignee.employeeId,
            status: 'todo',
          },
        });

        await tx.taskStatusEvent.create({
          data: {
            organizationId: orgId,
            assignmentId: assignment.id,
            fromStatus: null,
            toStatus: 'todo',
            actorUserId: caller.userId,
          },
        });

        if (assignee.userId !== caller.userId) {
          await tx.notification.create({
            data: {
              organizationId: orgId,
              userId: assignee.userId,
              type: 'task.assigned',
              title: `New task assigned: ${task.title}`,
              body: `Priority: ${task.priority}`,
              payload: { taskId: task.id, assignmentId: assignment.id },
              dedupeKey: `task.assigned:${task.id}:${assignee.userId}`,
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: 'task.created',
          entityType: 'task',
          entityId: task.id,
          metadata: {
            assignmentType: dto.assignmentType,
            departmentId,
            teamId,
            assigneeCount: assignees.length,
          },
        },
      });

      const responseData = {
        id: task.id,
        title: task.title,
        description: task.description,
        priority: task.priority,
        dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
        assignmentType: task.assignmentType,
        requiresReview: task.requiresReview,
        status: task.status,
        department: task.department,
        team: task.team,
        progress: { done: 0, total: assignees.length },
        createdAt: task.createdAt.toISOString(),
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

    return createdTask;
  }

  async listTasks(caller: AuthenticatedUser, query: ListTasksQueryDto) {
    const orgId = caller.organizationId;
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isDeptHead = caller.roles.includes('department_head');
    const callerCtx = await this.tasksRepo.findCallerEmployeeContext(orgId, caller.userId);

    const where: Record<string, unknown> = {
      organizationId: orgId,
    };

    if (!isSuperAdmin) {
      if (isDeptHead && callerCtx.headedDepartmentIds.length > 0) {
        where.OR = [
          { departmentId: { in: callerCtx.headedDepartmentIds } },
          { createdBy: caller.userId },
          ...(callerCtx.employeeId
            ? [{ assignments: { some: { employeeId: callerCtx.employeeId } } }]
            : []),
        ];
      } else {
        where.OR = [
          { createdBy: caller.userId },
          ...(callerCtx.employeeId
            ? [{ assignments: { some: { employeeId: callerCtx.employeeId } } }]
            : []),
        ];
      }
    }

    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.teamId) where.teamId = query.teamId;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.createdBy) where.createdBy = query.createdBy;
    if (query.assigneeId) {
      where.assignments = { some: { employeeId: query.assigneeId } };
    }

    if (query.dueFrom || query.dueTo || query.overdue === 'true') {
      const dueDateFilter: Record<string, unknown> = {};
      if (query.dueFrom) dueDateFilter.gte = new Date(`${query.dueFrom}T00:00:00Z`);
      if (query.dueTo) dueDateFilter.lte = new Date(`${query.dueTo}T00:00:00Z`);
      if (query.overdue === 'true') {
        const todayIso = new Date().toISOString().slice(0, 10);
        dueDateFilter.lt = new Date(`${todayIso}T00:00:00Z`);
        where.status = 'active';
      }
      where.dueDate = dueDateFilter;
    }

    const skip = (query.page - 1) * query.limit;
    const orderBy = { [query.sort]: query.order };

    const [total, tasks] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        skip,
        take: query.limit,
        orderBy,
        include: {
          department: { select: { id: true, name: true } },
          team: { select: { id: true, name: true } },
          creator: { select: { id: true, displayName: true } },
          assignments: { select: { status: true } },
        },
      }),
    ]);

    return {
      items: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        priority: t.priority,
        dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
        assignmentType: t.assignmentType,
        requiresReview: t.requiresReview,
        status: t.status,
        department: t.department,
        team: t.team,
        creator: t.creator,
        progress: this.computeProgress(t.assignments),
        createdAt: t.createdAt.toISOString(),
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getTaskById(taskId: string, caller: AuthenticatedUser) {
    const orgId = caller.organizationId;
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isDeptHead = caller.roles.includes('department_head');
    const callerCtx = await this.tasksRepo.findCallerEmployeeContext(orgId, caller.userId);

    const task = await this.prisma.task.findUnique({
      where: {
        organizationId_id: { organizationId: orgId, id: taskId },
      },
      include: {
        department: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
        creator: { select: { id: true, displayName: true, email: true } },
        assignments: {
          include: {
            employee: {
              select: {
                id: true,
                employeeCode: true,
                firstName: true,
                lastName: true,
              },
            },
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

    if (!isSuperAdmin && !isManagedHead && !isCreator && !isAssignee) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Task not found',
      });
    }

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
      assignmentType: task.assignmentType,
      requiresReview: task.requiresReview,
      status: task.status,
      cancelledAt: task.cancelledAt ? task.cancelledAt.toISOString() : null,
      cancelReason: task.cancelReason,
      department: task.department,
      team: task.team,
      creator: task.creator,
      progress: this.computeProgress(task.assignments),
      assignments: task.assignments.map((a) => ({
        id: a.id,
        status: a.status,
        employee: {
          id: a.employee.id,
          employeeCode: a.employee.employeeCode,
          fullName: `${a.employee.firstName} ${a.employee.lastName}`.trim(),
        },
      })),
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }

  async updateTask(taskId: string, dto: UpdateTaskDto, caller: AuthenticatedUser) {
    const orgId = caller.organizationId;
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isDeptHead = caller.roles.includes('department_head');
    const callerCtx = await this.tasksRepo.findCallerEmployeeContext(orgId, caller.userId);

    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({
        where: { organizationId_id: { organizationId: orgId, id: taskId } },
        include: {
          assignments: {
            select: {
              id: true,
              status: true,
              _count: { select: { submissions: true } },
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

      const canManage =
        isSuperAdmin ||
        task.createdBy === caller.userId ||
        (isDeptHead && callerCtx.headedDepartmentIds.includes(task.departmentId));

      if (!canManage) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You do not have permission to update this task',
        });
      }

      if (task.status === 'cancelled') {
        throw new ConflictException({
          code: 'TASK_CANCELLED',
          message: 'Cancelled tasks cannot be updated',
        });
      }

      if (
        dto.requiresReview !== undefined &&
        dto.requiresReview !== task.requiresReview
      ) {
        const hasSubmissions = task.assignments.some((a) => a._count.submissions > 0);
        if (hasSubmissions) {
          throw new ConflictException({
            code: 'REVIEW_SETTING_LOCKED',
            message: 'requiresReview cannot be changed after submissions exist',
          });
        }
      }

      const updateData: Record<string, unknown> = {};
      if (dto.title !== undefined) updateData.title = dto.title;
      if (dto.description !== undefined) updateData.description = dto.description;
      if (dto.priority !== undefined) updateData.priority = dto.priority;
      if (dto.dueDate !== undefined) {
        updateData.dueDate = dto.dueDate ? new Date(`${dto.dueDate}T00:00:00Z`) : null;
      }
      if (dto.requiresReview !== undefined) updateData.requiresReview = dto.requiresReview;

      const updated = await tx.task.update({
        where: { organizationId_id: { organizationId: orgId, id: taskId } },
        data: updateData,
        include: {
          department: { select: { id: true, name: true } },
          team: { select: { id: true, name: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: 'task.updated',
          entityType: 'task',
          entityId: taskId,
          metadata: { updatedFields: Object.keys(updateData) },
        },
      });

      return {
        id: updated.id,
        title: updated.title,
        description: updated.description,
        priority: updated.priority,
        dueDate: updated.dueDate ? updated.dueDate.toISOString().slice(0, 10) : null,
        assignmentType: updated.assignmentType,
        requiresReview: updated.requiresReview,
        status: updated.status,
        department: updated.department,
        team: updated.team,
        progress: this.computeProgress(task.assignments),
        updatedAt: updated.updatedAt.toISOString(),
      };
    });
  }

  async cancelTask(taskId: string, dto: CancelTaskDto, caller: AuthenticatedUser) {
    const orgId = caller.organizationId;
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isDeptHead = caller.roles.includes('department_head');
    const callerCtx = await this.tasksRepo.findCallerEmployeeContext(orgId, caller.userId);

    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({
        where: { organizationId_id: { organizationId: orgId, id: taskId } },
        include: {
          assignments: {
            select: { id: true, status: true },
          },
        },
      });

      if (!task) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Task not found',
        });
      }

      const canManage =
        isSuperAdmin ||
        task.createdBy === caller.userId ||
        (isDeptHead && callerCtx.headedDepartmentIds.includes(task.departmentId));

      if (!canManage) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You do not have permission to cancel this task',
        });
      }

      if (task.status === 'cancelled') {
        throw new ConflictException({
          code: 'ALREADY_CANCELLED',
          message: 'Task is already cancelled',
        });
      }

      const now = new Date();
      const updated = await tx.task.update({
        where: { organizationId_id: { organizationId: orgId, id: taskId } },
        data: {
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: dto.reason,
        },
      });

      const openAssignments = task.assignments.filter(
        (a) => a.status !== 'done' && a.status !== 'cancelled',
      );

      if (openAssignments.length > 0) {
        await tx.taskAssignment.updateMany({
          where: {
            organizationId: orgId,
            id: { in: openAssignments.map((a) => a.id) },
          },
          data: { status: 'cancelled' },
        });

        await tx.taskStatusEvent.createMany({
          data: openAssignments.map((a) => ({
            organizationId: orgId,
            assignmentId: a.id,
            fromStatus: a.status,
            toStatus: 'cancelled',
            actorUserId: caller.userId,
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: 'task.cancelled',
          entityType: 'task',
          entityId: taskId,
          metadata: {
            reason: dto.reason,
            cancelledAssignmentsCount: openAssignments.length,
          },
        },
      });

      return {
        id: updated.id,
        status: updated.status,
        cancelledAt: updated.cancelledAt?.toISOString() ?? now.toISOString(),
        cancelReason: updated.cancelReason,
        cancelledAssignmentsCount: openAssignments.length,
      };
    });
  }

  async getMyTasks(caller: AuthenticatedUser, query: MyTasksQueryDto) {
    const orgId = caller.organizationId;
    const callerCtx = await this.tasksRepo.findCallerEmployeeContext(orgId, caller.userId);

    if (!callerCtx.employeeId) {
      return {
        items: [],
        meta: { page: query.page, limit: query.limit, total: 0, totalPages: 0 },
      };
    }

    const where: Record<string, unknown> = {
      organizationId: orgId,
      employeeId: callerCtx.employeeId,
      ...(query.status ? { status: query.status } : { status: { not: 'cancelled' } }),
      task: {
        status: 'active',
        ...(query.priority ? { priority: query.priority } : {}),
      },
    };

    const skip = (query.page - 1) * query.limit;

    const [total, assignments] = await Promise.all([
      this.prisma.taskAssignment.count({ where }),
      this.prisma.taskAssignment.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ task: { dueDate: 'asc' } }, { createdAt: 'desc' }],
        include: {
          task: {
            select: {
              id: true,
              title: true,
              description: true,
              priority: true,
              dueDate: true,
              assignmentType: true,
              requiresReview: true,
              department: { select: { id: true, name: true } },
              team: { select: { id: true, name: true } },
            },
          },
          submissions: {
            orderBy: { version: 'desc' },
            take: 1,
            select: {
              version: true,
              reviewStatus: true,
              reviewedAt: true,
              reviewNote: true,
              submittedAt: true,
            },
          },
        },
      }),
    ]);

    return {
      items: assignments.map((a) => {
        const latestSub = a.submissions[0] ?? null;
        return {
          assignmentId: a.id,
          status: a.status,
          startedAt: a.startedAt ? a.startedAt.toISOString() : null,
          submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
          completedAt: a.completedAt ? a.completedAt.toISOString() : null,
          task: {
            id: a.task.id,
            title: a.task.title,
            description: a.task.description,
            priority: a.task.priority,
            dueDate: a.task.dueDate ? a.task.dueDate.toISOString().slice(0, 10) : null,
            assignmentType: a.task.assignmentType,
            requiresReview: a.task.requiresReview,
            department: a.task.department,
            team: a.task.team,
          },
          latestReview: latestSub
            ? {
                version: latestSub.version,
                reviewStatus: latestSub.reviewStatus,
                submittedAt: latestSub.submittedAt.toISOString(),
                reviewedAt: latestSub.reviewedAt ? latestSub.reviewedAt.toISOString() : null,
                reviewNote: latestSub.reviewNote,
              }
            : null,
        };
      }),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  private mapReducedBoardCard(t: {
    id: string;
    title: string;
    dueDate: Date | null;
    assignments: {
      status: string;
      employee: { firstName: string; lastName: string };
    }[];
  }) {
    const activeAssignments = t.assignments.filter((a) => a.status !== 'cancelled');
    const allDone =
      activeAssignments.length > 0 && activeAssignments.every((a) => a.status === 'done');
    const anyInReview = activeAssignments.some((a) => a.status === 'in_review');
    const anyInProgress = activeAssignments.some(
      (a) => a.status === 'in_progress' || a.status === 'changes_requested',
    );
    const boardStatus = allDone
      ? 'done'
      : anyInReview
        ? 'in_review'
        : anyInProgress
          ? 'in_progress'
          : 'todo';

    return {
      id: t.id,
      title: t.title,
      status: boardStatus,
      dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
      assignees: activeAssignments.map((a) =>
        `${a.employee.firstName} ${a.employee.lastName}`.trim(),
      ),
    };
  }

  async getDepartmentBoard(caller: AuthenticatedUser, query: DepartmentBoardQueryDto) {
    const orgId = caller.organizationId;
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isDeptHead = caller.roles.includes('department_head');
    const callerCtx = await this.tasksRepo.findCallerEmployeeContext(orgId, caller.userId);

    let targetDepartmentId: string | undefined = query.departmentId;

    if (!isSuperAdmin) {
      const allowedDeptIds = new Set<string>(
        isDeptHead ? callerCtx.headedDepartmentIds : [],
      );
      if (callerCtx.departmentId) {
        allowedDeptIds.add(callerCtx.departmentId);
      }

      if (targetDepartmentId) {
        if (!allowedDeptIds.has(targetDepartmentId)) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: 'Department board not found',
          });
        }
      } else {
        targetDepartmentId =
          callerCtx.departmentId ?? callerCtx.headedDepartmentIds[0];
        if (!targetDepartmentId) {
          return [];
        }
      }
    }

    const tasks = await this.prisma.task.findMany({
      where: {
        organizationId: orgId,
        status: 'active',
        ...(targetDepartmentId ? { departmentId: targetDepartmentId } : {}),
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        dueDate: true,
        assignments: {
          where: { status: { not: 'cancelled' } },
          select: {
            status: true,
            employee: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    return tasks.map((t) => this.mapReducedBoardCard(t));
  }

  async getTeamBoard(caller: AuthenticatedUser, query: TeamBoardQueryDto) {
    const orgId = caller.organizationId;
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isDeptHead = caller.roles.includes('department_head');
    const callerCtx = await this.tasksRepo.findCallerEmployeeContext(orgId, caller.userId);

    let targetTeamId = query.teamId;
    if (!targetTeamId) {
      if (callerCtx.employeeId) {
        const membership = await this.prisma.teamMember.findFirst({
          where: {
            organizationId: orgId,
            employeeId: callerCtx.employeeId,
            removedAt: null,
            team: { archivedAt: null },
          },
          select: { teamId: true },
        });
        targetTeamId = membership?.teamId;
      }

      if (!targetTeamId && isSuperAdmin) {
        const firstTeam = await this.prisma.team.findFirst({
          where: { organizationId: orgId, archivedAt: null },
          select: { id: true },
        });
        targetTeamId = firstTeam?.id;
      }

      if (!targetTeamId) {
        return [];
      }
    }

    const team = await this.prisma.team.findFirst({
      where: {
        organizationId: orgId,
        id: targetTeamId,
        archivedAt: null,
      },
      select: {
        id: true,
        departmentId: true,
        members: {
          where: { removedAt: null },
          select: { employeeId: true },
        },
      },
    });

    if (!team) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Team board not found',
      });
    }

    const isMember =
      callerCtx.employeeId !== null &&
      team.members.some((m) => m.employeeId === callerCtx.employeeId);
    const isManagedHead =
      isDeptHead && callerCtx.headedDepartmentIds.includes(team.departmentId);

    if (!isSuperAdmin && !isManagedHead && !isMember) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Team board not found',
      });
    }

    const tasks = await this.prisma.task.findMany({
      where: {
        organizationId: orgId,
        status: 'active',
        teamId: team.id,
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        dueDate: true,
        assignments: {
          where: { status: { not: 'cancelled' } },
          select: {
            status: true,
            employee: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    return tasks.map((t) => this.mapReducedBoardCard(t));
  }
}
