import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { createSubTaskSchema, updateSubTaskSchema } from './dto/sub-task.dto.js';
import { SubTasksService } from './sub-tasks.service.js';

const uuidParamSchema = z.string().uuid('id must be a valid UUID');

@Controller('tasks/:taskId/sub-tasks')
@UseGuards(AuthGuard)
export class SubTasksController {
  constructor(private readonly subTasksService: SubTasksService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createSubTask(
    @Param('taskId') taskId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const taskIdCheck = uuidParamSchema.safeParse(taskId);
    if (!taskIdCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'taskId', message: 'taskId must be a valid UUID' }],
      });
    }

    const parseResult = createSubTaskSchema.safeParse(body);
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

    const data = await this.subTasksService.createSubTask(
      taskIdCheck.data,
      parseResult.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Sub-task created successfully',
      data,
      meta: null,
    };
  }

  @Get()
  async listSubTasks(@Param('taskId') taskId: string, @Req() req: Request) {
    const taskIdCheck = uuidParamSchema.safeParse(taskId);
    if (!taskIdCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'taskId', message: 'taskId must be a valid UUID' }],
      });
    }

    const data = await this.subTasksService.listSubTasks(
      taskIdCheck.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Sub-tasks retrieved',
      data,
      meta: null,
    };
  }

  @Patch(':subTaskId')
  async updateSubTask(
    @Param('taskId') taskId: string,
    @Param('subTaskId') subTaskId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const taskIdCheck = uuidParamSchema.safeParse(taskId);
    const subTaskIdCheck = uuidParamSchema.safeParse(subTaskId);
    if (!taskIdCheck.success || !subTaskIdCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [
          ...(!taskIdCheck.success
            ? [{ field: 'taskId', message: 'taskId must be a valid UUID' }]
            : []),
          ...(!subTaskIdCheck.success
            ? [{ field: 'subTaskId', message: 'subTaskId must be a valid UUID' }]
            : []),
        ],
      });
    }

    const parseResult = updateSubTaskSchema.safeParse(body);
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

    const data = await this.subTasksService.updateSubTask(
      taskIdCheck.data,
      subTaskIdCheck.data,
      parseResult.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Sub-task updated successfully',
      data,
      meta: null,
    };
  }

  @Delete(':subTaskId')
  async deleteSubTask(
    @Param('taskId') taskId: string,
    @Param('subTaskId') subTaskId: string,
    @Req() req: Request,
  ) {
    const taskIdCheck = uuidParamSchema.safeParse(taskId);
    const subTaskIdCheck = uuidParamSchema.safeParse(subTaskId);
    if (!taskIdCheck.success || !subTaskIdCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [
          ...(!taskIdCheck.success
            ? [{ field: 'taskId', message: 'taskId must be a valid UUID' }]
            : []),
          ...(!subTaskIdCheck.success
            ? [{ field: 'subTaskId', message: 'subTaskId must be a valid UUID' }]
            : []),
        ],
      });
    }

    const data = await this.subTasksService.deleteSubTask(
      taskIdCheck.data,
      subTaskIdCheck.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Sub-task deleted successfully',
      data,
      meta: null,
    };
  }
}
