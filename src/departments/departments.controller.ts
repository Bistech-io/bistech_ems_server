import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { DepartmentsService } from './departments.service.js';
import { assignDepartmentHeadSchema } from './dto/assign-department-head.dto.js';

const uuidParamSchema = z.string().uuid('id must be a valid UUID');

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

  @Put('departments/:id/head')
  async assignDepartmentHead(
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

    const parseResult = assignDepartmentHeadSchema.safeParse(body);
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

    const data = await this.departmentsService.assignDepartmentHead(
      idCheck.data,
      parseResult.data,
      req.user!,
    );

    return {
      success: true,
      message: parseResult.data.employeeId
        ? 'Department head assigned successfully'
        : 'Department head removed successfully',
      data,
      meta: null,
    };
  }
}

