import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { updateEmployeeProfileSchema } from './dto/update-employee-profile.dto.js';
import { ProfileService } from './profile.service.js';

@Controller('employees')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('me/profile')
  async getMyProfile(@Req() req: Request) {
    const profile = await this.profileService.getMySensitiveProfile(req.user!);

    return {
      success: true,
      message: 'Employee sensitive profile retrieved',
      data: profile,
      meta: null,
    };
  }

  @Patch('me/profile')
  async updateMyProfile(@Body() body: unknown, @Req() req: Request) {
    const parseResult = updateEmployeeProfileSchema.safeParse(body ?? {});
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

    const profile = await this.profileService.updateMySensitiveProfile(
      parseResult.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Employee sensitive profile updated',
      data: profile,
      meta: null,
    };
  }

  @Get(':id/profile')
  async getEmployeeProfile(@Param('id') id: string, @Req() req: Request) {
    const profile = await this.profileService.getSensitiveProfile(id, req.user!);

    return {
      success: true,
      message: 'Employee sensitive profile retrieved',
      data: profile,
      meta: null,
    };
  }

  @Patch(':id/profile')
  async updateEmployeeProfile(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const parseResult = updateEmployeeProfileSchema.safeParse(body ?? {});
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

    const profile = await this.profileService.updateSensitiveProfile(
      id,
      parseResult.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Employee sensitive profile updated',
      data: profile,
      meta: null,
    };
  }
}
