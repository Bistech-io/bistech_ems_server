import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Headers,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { EmployeesService } from './employees.service.js';
import { createEmployeeSchema } from './dto/create-employee.dto.js';
import { EmploymentStatus } from '@prisma/client';

@Controller('employees')
@UseGuards(AuthGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createEmployee(
    @Body() body: unknown,
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const parseResult = createEmployeeSchema.safeParse(body);
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
    const employee = await this.employeesService.createEmployee(
      parseResult.data,
      caller,
      idempotencyKey,
    );

    return {
      success: true,
      message: 'Employee created and account provisioned successfully',
      data: employee,
      meta: null,
    };
  }

  @Get()
  async listEmployees(
    @Req() req: Request,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: EmploymentStatus,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const caller = req.user!;
    const { items, meta } = await this.employeesService.listEmployees(caller, {
      departmentId,
      employmentStatus: status,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    return {
      success: true,
      message: 'Employees retrieved',
      data: items,
      meta,
    };
  }

  @Get(':id')
  async getEmployeeById(@Param('id') id: string, @Req() req: Request) {
    const caller = req.user!;
    const employee = await this.employeesService.getEmployeeById(id, caller);

    return {
      success: true,
      message: 'Employee details retrieved',
      data: employee,
      meta: null,
    };
  }
}

