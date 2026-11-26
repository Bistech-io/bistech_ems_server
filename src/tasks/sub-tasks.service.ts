import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  CreateSubTaskDto,
  SubTaskStatusValue,
  UpdateSubTaskDto,
} from './dto/sub-task.dto.js';
import { TasksRepository } from './tasks.repository.js';

export interface SubTaskProgressDto {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  completionPercentage: number;
}

@Injectable()
export class SubTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksRepo: TasksRepository,
  ) {}

  private computeProgress(
    statuses: Array<{ status: SubTaskStatusValue | string }>,
  ): SubTaskProgressDto {
    const total = statuses.length;
    const completed = statuses.filter((s) => s.status === 'COMPLETED').length;
    const inProgress = statuses.filter((s) => s.status === 'IN_PROGRESS').length;
    const pending = statuses.filter((s) => s.status === 'PENDING').length;
    const completionPercentage = total === 0 ? 0 : Math.round((completed / total) * 100);

    return {
      total,
      completed,
      inProgress,
      pending,
      completionPercentage,
    };
  }

  private mapSubTask(row: {
    id: string;
    taskId: string;
    title: string;
    description: string | null;
    status: string;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    creator: { id: string; displayName: string; email: string };
  }) {
    return {
      id: row.id,
      taskId: row.taskId,
      title: row.title,
      description: row.description,
      status: row.status,
      creator: row.creator,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async assertCanManageSubTasks(
    taskId: string,
    caller: AuthenticatedUser,
  ) {
    const orgId = caller.organizationId;
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isDeptHead = caller.roles.includes('department_head');
    const callerCtx = await this.tasksRepo.findCallerEmployeeContext(
      orgId,
      caller.userId,
    );

    const task = await this.prisma.task.findUnique({
      where: {
        organizationId_id: { organizationId: orgId, id: taskId },
      },
      select: {
        id: true,
        departmentId: true,
        createdBy: true,
        assignments: {
          where: { status: { not: 'cancelled' } },
          select: { employeeId: true },
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
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message:
          'Only the task creator, assigned employees, or authorized admins can manage sub-tasks',
      });
    }

    return task;
  }

  async createSubTask(
    taskId: string,
    dto: CreateSubTaskDto,
    caller: AuthenticatedUser,
  ) {
    await this.assertCanManageSubTasks(taskId, caller);
    const orgId = caller.organizationId;
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.subTask.create({
        data: {
          organizationId: orgId,
          taskId,
          createdBy: caller.userId,
          title: dto.title,
          description: dto.description ?? null,
          status: dto.status,
          completedAt: dto.status === 'COMPLETED' ? now : null,
        },
        include: {
          creator: { select: { id: true, displayName: true, email: true } },
        },
      });

      const allStatuses = await tx.subTask.findMany({
        where: { organizationId: orgId, taskId },
        select: { status: true },
      });

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: 'task.sub_task_created',
          entityType: 'sub_task',
          entityId: created.id,
          metadata: { taskId, status: created.status },
        },
      });

      return {
        ...this.mapSubTask(created),
        progress: this.computeProgress(allStatuses),
      };
    });
  }

  async listSubTasks(taskId: string, caller: AuthenticatedUser) {
    await this.assertCanManageSubTasks(taskId, caller);

    const rows = await this.prisma.subTask.findMany({
      where: {
        organizationId: caller.organizationId,
        taskId,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        creator: { select: { id: true, displayName: true, email: true } },
      },
    });

    return {
      items: rows.map((row) => this.mapSubTask(row)),
      progress: this.computeProgress(rows),
    };
  }

  async updateSubTask(
    taskId: string,
    subTaskId: string,
    dto: UpdateSubTaskDto,
    caller: AuthenticatedUser,
  ) {
    await this.assertCanManageSubTasks(taskId, caller);
    const orgId = caller.organizationId;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.subTask.findFirst({
        where: {
          id: subTaskId,
          taskId,
          organizationId: orgId,
        },
      });

      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Sub-task not found',
        });
      }

      const nextStatus = dto.status ?? existing.status;
      const completedAt =
        dto.status === undefined
          ? existing.completedAt
          : dto.status === 'COMPLETED'
            ? existing.completedAt ?? new Date()
            : null;

      const updated = await tx.subTask.update({
        where: { id: existing.id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          status: nextStatus,
          completedAt,
        },
        include: {
          creator: { select: { id: true, displayName: true, email: true } },
        },
      });

      const allStatuses = await tx.subTask.findMany({
        where: { organizationId: orgId, taskId },
        select: { status: true },
      });

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: 'task.sub_task_updated',
          entityType: 'sub_task',
          entityId: updated.id,
          metadata: { taskId, status: updated.status },
        },
      });

      return {
        ...this.mapSubTask(updated),
        progress: this.computeProgress(allStatuses),
      };
    });
  }

  async deleteSubTask(
    taskId: string,
    subTaskId: string,
    caller: AuthenticatedUser,
  ) {
    await this.assertCanManageSubTasks(taskId, caller);
    const orgId = caller.organizationId;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.subTask.findFirst({
        where: {
          id: subTaskId,
          taskId,
          organizationId: orgId,
        },
      });

      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Sub-task not found',
        });
      }

      await tx.subTask.delete({
        where: { id: existing.id },
      });

      const allStatuses = await tx.subTask.findMany({
        where: { organizationId: orgId, taskId },
        select: { status: true },
      });

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          actorUserId: caller.userId,
          action: 'task.sub_task_deleted',
          entityType: 'sub_task',
          entityId: existing.id,
          metadata: { taskId },
        },
      });

      return {
        id: existing.id,
        progress: this.computeProgress(allStatuses),
      };
    });
  }
}
