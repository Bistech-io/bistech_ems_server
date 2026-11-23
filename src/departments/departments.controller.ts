import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { DepartmentsService } from './departments.service.js';
import { assignDepartmentHeadSchema } from './dto/assign-department-head.dto.js';
import {
  createDepartmentSchema,
  updateDepartmentSchema,
} from './dto/department.dto.js';
import {
  createDesignationSchema,
  updateDesignationSchema,
} from './dto/designation.dto.js';

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

  @Post('departments')
  @HttpCode(HttpStatus.CREATED)
  async createDepartment(@Body() body: unknown, @Req() req: Request) {
    const parseResult = createDepartmentSchema.safeParse(body);
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
    const data = await this.departmentsService.createDepartment(
      caller.organizationId,
      parseResult.data,
      caller,
    );

    return {
      success: true,
      message: 'Department created',
      data,
      meta: null,
    };
  }

  @Patch('departments/:id')
  async updateDepartment(
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

    const parseResult = updateDepartmentSchema.safeParse(body);
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
    const data = await this.departmentsService.updateDepartment(
      caller.organizationId,
      idCheck.data,
      parseResult.data,
      caller,
    );

    return {
      success: true,
      message: 'Department updated',
      data,
      meta: null,
    };
  }

  @Delete('departments/:id')
  @HttpCode(HttpStatus.OK)
  async deleteDepartment(@Param('id') id: string, @Req() req: Request) {
    const idCheck = uuidParamSchema.safeParse(id);
    if (!idCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'id', message: 'id must be a valid UUID' }],
      });
    }

    const caller = req.user!;
    await this.departmentsService.deleteDepartment(
      caller.organizationId,
      idCheck.data,
      caller,
    );

    return {
      success: true,
      message: 'Department archived',
      data: null,
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

  @Post('designations')
  @HttpCode(HttpStatus.CREATED)
  async createDesignation(@Body() body: unknown, @Req() req: Request) {
    const parseResult = createDesignationSchema.safeParse(body);
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
    const data = await this.departmentsService.createDesignation(
      caller.organizationId,
      parseResult.data.title,
      caller,
    );

    return {
      success: true,
      message: 'Designation created',
      data,
      meta: null,
    };
  }

  @Patch('designations/:id')
  async updateDesignation(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const parseResult = updateDesignationSchema.safeParse(body);
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
    const data = await this.departmentsService.updateDesignation(
      caller.organizationId,
      id,
      parseResult.data.title,
      caller,
    );

    return {
      success: true,
      message: 'Designation updated',
      data,
      meta: null,
    };
  }

  @Delete('designations/:id')
  @HttpCode(HttpStatus.OK)
  async deleteDesignation(@Param('id') id: string, @Req() req: Request) {
    const caller = req.user!;
    await this.departmentsService.deleteDesignation(
      caller.organizationId,
      id,
      caller,
    );

    return {
      success: true,
      message: 'Designation archived',
      data: null,
      meta: null,
    };
  }
}
