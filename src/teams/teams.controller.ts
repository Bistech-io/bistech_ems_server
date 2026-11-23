import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import {
  addTeamMembersSchema,
  createTeamSchema,
  listTeamsQuerySchema,
  updateTeamSchema,
} from './dto/team.dto.js';
import { TeamsService } from './teams.service.js';

const uuidParamSchema = z.string().uuid('id must be a valid UUID');

@Controller('teams')
@UseGuards(AuthGuard)
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  async listTeams(@Req() req: Request, @Query() rawQuery: Record<string, unknown>) {
    const parseResult = listTeamsQuerySchema.safeParse(rawQuery);
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

    const { items, meta } = await this.teamsService.listTeams(
      req.user!,
      parseResult.data,
    );

    return {
      success: true,
      message: 'Teams retrieved',
      data: items,
      meta,
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createTeam(@Body() body: unknown, @Req() req: Request) {
    const parseResult = createTeamSchema.safeParse(body);
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

    const data = await this.teamsService.createTeam(parseResult.data, req.user!);

    return {
      success: true,
      message: 'Team created successfully',
      data,
      meta: null,
    };
  }

  @Get(':id')
  async getTeamById(@Param('id') id: string, @Req() req: Request) {
    const idCheck = uuidParamSchema.safeParse(id);
    if (!idCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'id', message: 'id must be a valid UUID' }],
      });
    }

    const data = await this.teamsService.getTeamById(idCheck.data, req.user!);

    return {
      success: true,
      message: 'Team retrieved',
      data,
      meta: null,
    };
  }

  @Patch(':id')
  async updateTeam(
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

    const parseResult = updateTeamSchema.safeParse(body);
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

    const data = await this.teamsService.updateTeam(
      idCheck.data,
      parseResult.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Team updated successfully',
      data,
      meta: null,
    };
  }

  @Delete(':id')
  async archiveTeam(@Param('id') id: string, @Req() req: Request) {
    const idCheck = uuidParamSchema.safeParse(id);
    if (!idCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'id', message: 'id must be a valid UUID' }],
      });
    }

    const data = await this.teamsService.archiveTeam(idCheck.data, req.user!);

    return {
      success: true,
      message: 'Team archived successfully',
      data,
      meta: null,
    };
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.CREATED)
  async addMembers(
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

    const parseResult = addTeamMembersSchema.safeParse(body);
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

    const data = await this.teamsService.addTeamMembers(
      idCheck.data,
      parseResult.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Team members added successfully',
      data,
      meta: null,
    };
  }

  @Delete(':id/members/:employeeId')
  async removeMember(
    @Param('id') id: string,
    @Param('employeeId') employeeId: string,
    @Req() req: Request,
  ) {
    const idCheck = uuidParamSchema.safeParse(id);
    const empCheck = uuidParamSchema.safeParse(employeeId);
    if (!idCheck.success || !empCheck.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [{ field: 'id', message: 'id and employeeId must be valid UUIDs' }],
      });
    }

    const data = await this.teamsService.removeTeamMember(
      idCheck.data,
      empCheck.data,
      req.user!,
    );

    return {
      success: true,
      message: 'Team member removed successfully',
      data,
      meta: null,
    };
  }
}
