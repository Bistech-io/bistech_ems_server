import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import {
  createCommentSchema,
  listCommentsQuerySchema,
} from './dto/task-workflow.dto.js';
import { TasksWorkflowService } from './tasks-workflow.service.js';

const uuidParamSchema = z.string().uuid('id must be a valid UUID');

@Controller('tasks')
@UseGuards(AuthGuard)
export class CommentsController {
  constructor(private readonly workflowService: TasksWorkflowService) {}

  @Get(':id/comments')
  async listComments(
    @Param('id') id: string,
    @Query() rawQuery: Record<string, unknown>,
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

    const parseResult = listCommentsQuerySchema.safeParse(rawQuery);
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

    const { items, meta } = await this.workflowService.listComments(
      idCheck.data,
      req.user!,
      parseResult.data,
    );

    return {
      success: true,
      message: 'Task comments retrieved',
      data: items,
      meta,
    };
  }

  @Post(':id/comments')
  @HttpCode(HttpStatus.CREATED)
  async createComment(
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

    const parseResult = createCommentSchema.safeParse(body);
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

    const data = await this.workflowService.createComment(
      idCheck.data,
      parseResult.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Comment posted successfully',
      data,
      meta: null,
    };
  }
}
