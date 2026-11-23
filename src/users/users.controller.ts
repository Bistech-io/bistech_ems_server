import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { listUsersQuerySchema } from './dto/list-users-query.dto.js';
import { updateUserRolesSchema } from './dto/update-user-roles.dto.js';
import { UsersService } from './users.service.js';

const uuidParamSchema = z.string().uuid('id must be a valid UUID');

@Controller()
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('users')
  async listUsers(@Req() req: Request, @Query() rawQuery: Record<string, unknown>) {
    const parseResult = listUsersQuerySchema.safeParse(rawQuery);
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

    const { items, meta } = await this.usersService.listUsers(
      req.user!,
      parseResult.data,
    );

    return {
      success: true,
      message: 'Users retrieved',
      data: items,
      meta,
    };
  }

  @Get('roles')
  async listRoles(@Req() req: Request) {
    const data = await this.usersService.listRoles(req.user!);

    return {
      success: true,
      message: 'Roles retrieved',
      data,
      meta: null,
    };
  }

  @Put('users/:id/roles')
  async updateUserRoles(
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

    const parseResult = updateUserRolesSchema.safeParse(body);
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

    const data = await this.usersService.updateUserRoles(
      idCheck.data,
      parseResult.data,
      req.user!,
    );

    return {
      success: true,
      message: 'User roles updated successfully',
      data,
      meta: null,
    };
  }
}
