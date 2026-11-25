import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
  createFeedbackSchema,
  listFeedbackQuerySchema,
  updateFeedbackSchema,
} from './dto/feedback.dto.js';
import { FeedbackService } from './feedback.service.js';

const uuidParamSchema = z.string().uuid('id must be a valid UUID');

@Controller('feedback')
@UseGuards(AuthGuard)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createFeedback(
    @Body() body: unknown,
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const parseResult = createFeedbackSchema.safeParse(body);
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

    const data = await this.feedbackService.createFeedback(
      parseResult.data,
      req.user!,
      idempotencyKey,
    );

    return {
      success: true,
      message: 'Issue or suggestion submitted successfully',
      data,
      meta: null,
    };
  }

  @Get()
  async listFeedback(
    @Req() req: Request,
    @Query() rawQuery: Record<string, unknown>,
  ) {
    const parseResult = listFeedbackQuerySchema.safeParse(rawQuery);
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

    const { items, meta } = await this.feedbackService.listFeedback(
      req.user!,
      parseResult.data,
    );

    return {
      success: true,
      message: 'Issues and suggestions retrieved',
      data: items,
      meta,
    };
  }

  @Get(':id')
  async getFeedbackById(@Param('id') id: string, @Req() req: Request) {
    const idCheck = uuidParamSchema.safeParse(id);
    if (!idCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'id', message: 'id must be a valid UUID' }],
      });
    }

    const data = await this.feedbackService.getFeedbackById(
      idCheck.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Issue or suggestion retrieved',
      data,
      meta: null,
    };
  }

  @Patch(':id')
  async updateFeedback(
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

    const parseResult = updateFeedbackSchema.safeParse(body);
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

    const data = await this.feedbackService.updateFeedback(
      idCheck.data,
      parseResult.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Issue or suggestion updated successfully',
      data,
      meta: null,
    };
  }

  @Delete(':id')
  async deleteFeedback(@Param('id') id: string, @Req() req: Request) {
    const idCheck = uuidParamSchema.safeParse(id);
    if (!idCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'id', message: 'id must be a valid UUID' }],
      });
    }

    const data = await this.feedbackService.deleteFeedback(
      idCheck.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Issue or suggestion deleted successfully',
      data,
      meta: null,
    };
  }
}
