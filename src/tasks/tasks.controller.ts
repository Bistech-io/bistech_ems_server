import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import {
  cancelTaskSchema,
  createTaskSchema,
  listTasksQuerySchema,
  updateTaskSchema,
} from './dto/task.dto.js';
import {
  departmentBoardQuerySchema,
  myTasksQuerySchema,
  teamBoardQuerySchema,
} from './dto/task-board.dto.js';
import {
  createSubmissionSchema,
  requestTaskReviewSchema,
  updateAssignmentStatusSchema,
} from './dto/task-workflow.dto.js';
import { TasksWorkflowService } from './tasks-workflow.service.js';
import { TasksService } from './tasks.service.js';

const uuidParamSchema = z.string().uuid('id must be a valid UUID');

@Controller('tasks')
@UseGuards(AuthGuard)
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly workflowService: TasksWorkflowService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createTask(
    @Body() body: unknown,
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (idempotencyKey !== undefined) {
      const keyCheck = uuidParamSchema.safeParse(idempotencyKey);
      if (!keyCheck.success) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Idempotency-Key must be a valid UUID',
        });
      }
    }

    const parseResult = createTaskSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const data = await this.tasksService.createTask(
      parseResult.data,
      req.user!,
      idempotencyKey,
    );

    return {
      success: true,
      message: 'Task created successfully',
      data,
      meta: null,
    };
  }

  @Get()
  async listTasks(@Req() req: Request, @Query() rawQuery: Record<string, unknown>) {
    const parseResult = listTasksQuerySchema.safeParse(rawQuery);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const { items, meta } = await this.tasksService.listTasks(
      req.user!,
      parseResult.data,
    );

    return {
      success: true,
      message: 'Tasks retrieved',
      data: items,
      meta,
    };
  }

  @Get('me')
  async getMyTasks(@Req() req: Request, @Query() rawQuery: Record<string, unknown>) {
    const parseResult = myTasksQuerySchema.safeParse(rawQuery);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const { items, meta } = await this.tasksService.getMyTasks(
      req.user!,
      parseResult.data,
    );

    return {
      success: true,
      message: 'My task assignments retrieved',
      data: items,
      meta,
    };
  }

  @Get('board/department')
  async getDepartmentBoard(
    @Req() req: Request,
    @Query() rawQuery: Record<string, unknown>,
  ) {
    const parseResult = departmentBoardQuerySchema.safeParse(rawQuery);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const data = await this.tasksService.getDepartmentBoard(
      req.user!,
      parseResult.data,
    );

    return {
      success: true,
      message: 'Department task board retrieved',
      data,
      meta: null,
    };
  }

  @Get('board/team')
  async getTeamBoard(@Req() req: Request, @Query() rawQuery: Record<string, unknown>) {
    const parseResult = teamBoardQuerySchema.safeParse(rawQuery);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const data = await this.tasksService.getTeamBoard(req.user!, parseResult.data);

    return {
      success: true,
      message: 'Team task board retrieved',
      data,
      meta: null,
    };
  }

  @Get(':id')
  async getTaskById(@Param('id') id: string, @Req() req: Request) {
    const idCheck = uuidParamSchema.safeParse(id);
    if (!idCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'id', message: 'id must be a valid UUID' }],
      });
    }

    const data = await this.tasksService.getTaskById(idCheck.data, req.user!);

    return {
      success: true,
      message: 'Task retrieved',
      data,
      meta: null,
    };
  }

  @Patch(':id')
  async updateTask(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const idCheck = uuidParamSchema.safeParse(id);
    if (!idCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'id', message: 'id must be a valid UUID' }],
      });
    }

    const parseResult = updateTaskSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const data = await this.tasksService.updateTask(
      idCheck.data,
      parseResult.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Task updated successfully',
      data,
      meta: null,
    };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelTask(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const idCheck = uuidParamSchema.safeParse(id);
    if (!idCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'id', message: 'id must be a valid UUID' }],
      });
    }

    const parseResult = cancelTaskSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const data = await this.tasksService.cancelTask(
      idCheck.data,
      parseResult.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Task cancelled successfully',
      data,
      meta: null,
    };
  }

  @Patch(':taskId/assignments/:id/status')
  async updateNestedAssignmentStatus(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const idCheck = uuidParamSchema.safeParse(id);
    if (!idCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'id', message: 'id must be a valid UUID' }],
      });
    }

    const parseResult = updateAssignmentStatusSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const data = await this.workflowService.updateAssignmentStatus(
      idCheck.data,
      parseResult.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Assignment status updated',
      data,
      meta: null,
    };
  }

  @Post(':taskId/assignments/:id/submissions')
  @HttpCode(HttpStatus.CREATED)
  async submitNestedAssignment(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const idCheck = uuidParamSchema.safeParse(id);
    if (!idCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'id', message: 'id must be a valid UUID' }],
      });
    }

    if (idempotencyKey !== undefined) {
      const keyCheck = uuidParamSchema.safeParse(idempotencyKey);
      if (!keyCheck.success) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Idempotency-Key must be a valid UUID',
        });
      }
    }

    const parseResult = createSubmissionSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const data = await this.workflowService.submitAssignment(
      idCheck.data,
      parseResult.data,
      req.user!,
      idempotencyKey,
    );

    return {
      success: true,
      message: 'Submission recorded successfully',
      data,
      meta: null,
    };
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  async requestTaskReview(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const idCheck = uuidParamSchema.safeParse(id);
    if (!idCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'id', message: 'id must be a valid UUID' }],
      });
    }

    const parseResult = requestTaskReviewSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const data = await this.workflowService.requestTaskReview(
      idCheck.data,
      parseResult.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Review request sent successfully',
      data,
      meta: null,
    };
  }
}
