import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import {
  listSubmissionsQuerySchema,
  reviewSubmissionSchema,
} from './dto/task-workflow.dto.js';
import { TasksWorkflowService } from './tasks-workflow.service.js';

const uuidParamSchema = z.string().uuid('id must be a valid UUID');

@Controller('task-submissions')
@UseGuards(AuthGuard)
export class SubmissionsController {
  constructor(private readonly workflowService: TasksWorkflowService) {}

  @Get()
  async listSubmissions(
    @Req() req: Request,
    @Query() rawQuery: Record<string, unknown>,
  ) {
    const parseResult = listSubmissionsQuerySchema.safeParse(rawQuery);
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

    const { items, meta } = await this.workflowService.listSubmissions(
      req.user!,
      parseResult.data,
    );

    return {
      success: true,
      message: 'Task submissions retrieved',
      data: items,
      meta,
    };
  }

  @Patch(':id/review')
  async reviewSubmission(
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

    const parseResult = reviewSubmissionSchema.safeParse(body);
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

    const data = await this.workflowService.reviewSubmission(
      idCheck.data,
      parseResult.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Submission reviewed successfully',
      data,
      meta: null,
    };
  }
}
