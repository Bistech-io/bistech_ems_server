import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('me')
  async getMyDashboard(@Req() req: Request) {
    const caller = req.user!;
    const data = await this.dashboardService.getMyOverviewDashboard(
      caller.organizationId,
      caller.userId,
    );

    return {
      success: true,
      message: 'Employee overview dashboard retrieved',
      data,
      meta: null,
    };
  }
}
