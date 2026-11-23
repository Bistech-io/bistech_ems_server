import {
  Controller,
  Get,
  Patch,
  Body,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { OrganizationService } from './organization.service.js';
import { updateOrganizationSettingsSchema } from './dto/update-settings.dto.js';

@Controller('organization')
@UseGuards(AuthGuard)
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Get('settings')
  async getSettings(@Req() req: Request) {
    const orgId = req.user!.organizationId;
    const data = await this.organizationService.getSettings(orgId);
    return {
      success: true,
      message: 'Organization settings retrieved',
      data,
      meta: null,
    };
  }

  @Patch('settings')
  async updateSettings(@Body() body: unknown, @Req() req: Request) {
    const parseResult = updateOrganizationSettingsSchema.safeParse(body);
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
    const data = await this.organizationService.updateSettings(
      caller.organizationId,
      parseResult.data,
      caller,
    );

    return {
      success: true,
      message: 'Organization settings updated successfully',
      data,
      meta: null,
    };
  }

  @Get()
  async getOrganization(@Req() req: Request) {
    return this.getSettings(req);
  }

  @Patch()
  async updateOrganization(@Body() body: unknown, @Req() req: Request) {
    return this.updateSettings(body, req);
  }
}

