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
import { TasksService } from './tasks.service.js';

const uuidParamSchema = z.string().uuid('id must be a valid UUID');

@Controller('tasks')
@UseGuards(AuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

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
}
