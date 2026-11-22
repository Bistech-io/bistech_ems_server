import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { AttendanceService } from './attendance.service.js';
import { attendanceMeQuerySchema } from './dto/attendance-me-query.dto.js';
import { checkInSchema } from './dto/check-in.dto.js';

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
}
