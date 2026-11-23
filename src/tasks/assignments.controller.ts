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
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import {
  createSubmissionSchema,
  updateAssignmentStatusSchema,
} from './dto/task-workflow.dto.js';
import { TasksWorkflowService } from './tasks-workflow.service.js';

const uuidParamSchema = z.string().uuid('id must be a valid UUID');

@Controller('task-assignments')
@UseGuards(AuthGuard)
export class AssignmentsController {
  constructor(private readonly workflowService: TasksWorkflowService) {}

  @Get(':id')
  async getAssignment(@Param('id') id: string, @Req() req: Request) {
    const idCheck = uuidParamSchema.safeParse(id);
    if (!idCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'id', message: 'id must be a valid UUID' }],
      });
    }

    const data = await this.workflowService.getAssignmentById(
      idCheck.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Task assignment retrieved',
      data,
      meta: null,
    };
  }

  @Patch(':id/status')
  async updateStatus(
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

  @Post(':id/submissions')
  @HttpCode(HttpStatus.CREATED)
  async submitWork(
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
}
