import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { DepartmentsService } from './departments.service.js';
import {
  createDesignationSchema,
  updateDesignationSchema,
} from './dto/designation.dto.js';

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
