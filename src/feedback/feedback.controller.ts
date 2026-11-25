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
  createFeedbackCommentSchema,
  createFeedbackSchema,
  listFeedbackCommentsQuerySchema,
  listFeedbackQuerySchema,
  updateFeedbackCommentSchema,
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

  @Get(':id/comments')
  async listComments(
    @Param('id') id: string,
    @Req() req: Request,
    @Query() rawQuery: Record<string, unknown>,
  ) {
    const idCheck = uuidParamSchema.safeParse(id);
    if (!idCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'id', message: 'id must be a valid UUID' }],
      });
    }

    const parseResult = listFeedbackCommentsQuerySchema.safeParse(rawQuery);
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

    const { items, meta } = await this.feedbackService.listComments(
      idCheck.data,
      req.user!,
      parseResult.data,
    );

    return {
      success: true,
      message: 'Feedback comments retrieved',
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

    const parseResult = createFeedbackCommentSchema.safeParse(body);
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

    const data = await this.feedbackService.createComment(
      idCheck.data,
      parseResult.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Comment added successfully',
      data,
      meta: null,
    };
  }

  @Patch(':id/comments/:commentId')
  async updateComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const idCheck = uuidParamSchema.safeParse(id);
    const commentIdCheck = uuidParamSchema.safeParse(commentId);
    if (!idCheck.success || !commentIdCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [
          ...(!idCheck.success ? [{ field: 'id', message: 'id must be a valid UUID' }] : []),
          ...(!commentIdCheck.success
            ? [{ field: 'commentId', message: 'commentId must be a valid UUID' }]
            : []),
        ],
      });
    }

    const parseResult = updateFeedbackCommentSchema.safeParse(body);
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

    const data = await this.feedbackService.updateComment(
      idCheck.data,
      commentIdCheck.data,
      parseResult.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Comment updated successfully',
      data,
      meta: null,
    };
  }

  @Delete(':id/comments/:commentId')
  async deleteComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @Req() req: Request,
  ) {
    const idCheck = uuidParamSchema.safeParse(id);
    const commentIdCheck = uuidParamSchema.safeParse(commentId);
    if (!idCheck.success || !commentIdCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [
          ...(!idCheck.success ? [{ field: 'id', message: 'id must be a valid UUID' }] : []),
          ...(!commentIdCheck.success
            ? [{ field: 'commentId', message: 'commentId must be a valid UUID' }]
            : []),
        ],
      });
    }

    const data = await this.feedbackService.deleteComment(
      idCheck.data,
      commentIdCheck.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Comment deleted successfully',
      data,
      meta: null,
    };
  }
}
