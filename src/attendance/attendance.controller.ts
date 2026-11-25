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
import { AttendanceService } from './attendance.service.js';
import {
  attendanceListQuerySchema,
  attendanceSummaryQuerySchema,
} from './dto/attendance-list-query.dto.js';
import { attendanceMeQuerySchema } from './dto/attendance-me-query.dto.js';
import { checkInSchema } from './dto/check-in.dto.js';
import { checkOutSchema } from './dto/check-out.dto.js';

const uuidParamSchema = z.string().uuid('id must be a valid UUID');

@Controller('attendance')
@UseGuards(AuthGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('check-in')
  @HttpCode(HttpStatus.CREATED)
  async checkIn(@Req() req: Request, @Body() body: unknown) {
    const parseResult = checkInSchema.safeParse(body ?? {});
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

    const caller = req.user!;
    const record = await this.attendanceService.checkIn(
      caller.organizationId,
      caller.userId,
      parseResult.data,
    );

    return {
      success: true,
      message: 'Check-in recorded successfully',
      data: record,
      meta: null,
    };
  }

  @Post('check-out')
  @HttpCode(HttpStatus.OK)
  async checkOut(@Req() req: Request, @Body() body: unknown) {
    const parseResult = checkOutSchema.safeParse(body ?? {});
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

    const caller = req.user!;
    const record = await this.attendanceService.checkOut(
      caller.organizationId,
      caller.userId,
      parseResult.data,
    );

    return {
      success: true,
      message: 'Check-out recorded successfully',
      data: record,
      meta: null,
    };
  }

  @Get('me')
  async getMyAttendance(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const parseResult = attendanceMeQuerySchema.safeParse({ from, to });
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

    const caller = req.user!;
    const board = await this.attendanceService.getMyAttendanceBoard(
      caller.organizationId,
      caller.userId,
      parseResult.data,
    );

    return {
      success: true,
      message: 'Employee attendance board retrieved',
      data: board,
      meta: null,
    };
  }

  @Get('summary')
  async getAttendanceSummary(@Req() req: Request, @Query() rawQuery: Record<string, unknown>) {
    const parseResult = attendanceSummaryQuerySchema.safeParse(rawQuery);
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

    const summary = await this.attendanceService.getAttendanceSummary(
      req.user!,
      parseResult.data,
    );

    return {
      success: true,
      message: 'Attendance summary retrieved',
      data: summary,
      meta: null,
    };
  }

  @Get()
  async listAttendance(@Req() req: Request, @Query() rawQuery: Record<string, unknown>) {
    const parseResult = attendanceListQuerySchema.safeParse(rawQuery);
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

    const { items, meta } = await this.attendanceService.listAttendance(
      req.user!,
      parseResult.data,
    );

    return {
      success: true,
      message: 'Attendance records retrieved',
      data: items,
      meta,
    };
  }

  @Get(':id')
  async getAttendanceById(@Param('id') id: string, @Req() req: Request) {
    const idCheck = uuidParamSchema.safeParse(id);
    if (!idCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'id', message: 'id must be a valid UUID' }],
      });
    }

    const record = await this.attendanceService.getAttendanceById(req.user!, idCheck.data);

    return {
      success: true,
      message: 'Attendance record retrieved',
      data: record,
      meta: null,
    };
  }
}
