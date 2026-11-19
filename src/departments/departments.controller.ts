import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { DepartmentsService } from './departments.service.js';

@Controller()
@UseGuards(AuthGuard)
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get('departments')
  async getDepartments(@Req() req: Request) {
    const orgId = req.user!.organizationId;
    const data = await this.departmentsService.listDepartments(orgId);
    return {
      success: true,
      message: 'Departments loaded',
      data,
      meta: null,
    };
  }

  @Get('designations')
  async getDesignations(@Req() req: Request) {
    const orgId = req.user!.organizationId;
    const data = await this.departmentsService.listDesignations(orgId);
    return {
      success: true,
      message: 'Designations loaded',
      data,
      meta: null,
    };
  }
}

