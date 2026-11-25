import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import type { UpdateOrganizationSettingsDto } from './dto/update-settings.dto.js';

export interface OrganizationSettingsData {
  workStart: string;
  graceMinutes: number;
  workEnd: string;
  weekendDays: number[];
  timezone: string;
  name: string;
  slug: string;
}

const DEFAULT_SCHEDULE_SETTINGS = {
  workStart: '10:00',
  graceMinutes: 15,
  workEnd: '18:30',
  weekendDays: [5, 6],
};

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(organizationId: string): Promise<OrganizationSettingsData> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!org) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Organization not found',
      });
    }

    const rawSettings = (org.settings as Record<string, unknown>) || {};

    return {
      workStart:
        typeof rawSettings.workStart === 'string'
          ? rawSettings.workStart
          : DEFAULT_SCHEDULE_SETTINGS.workStart,
      graceMinutes:
        typeof rawSettings.graceMinutes === 'number'
          ? rawSettings.graceMinutes
          : DEFAULT_SCHEDULE_SETTINGS.graceMinutes,
      workEnd:
        typeof rawSettings.workEnd === 'string'
          ? rawSettings.workEnd
          : DEFAULT_SCHEDULE_SETTINGS.workEnd,
      weekendDays: Array.isArray(rawSettings.weekendDays)
        ? (rawSettings.weekendDays as number[])
        : DEFAULT_SCHEDULE_SETTINGS.weekendDays,
      timezone: org.timezone,
      name: org.name,
      slug: org.slug,
    };
  }

  async updateSettings(
    organizationId: string,
    dto: UpdateOrganizationSettingsDto,
    caller: AuthenticatedUser,
  ): Promise<OrganizationSettingsData> {
    const isSuperAdmin = caller.roles.includes('super_admin');
    const isHrManager = caller.roles.includes('hr_manager');

    if (!isSuperAdmin && !isHrManager) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only HR Managers or Super Admins can update organization settings',
      });
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!org) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Organization not found',
      });
    }

    const currentSettings = (org.settings as Record<string, unknown>) || {};
    const updatedSettings = {
      ...currentSettings,
      ...(dto.workStart !== undefined ? { workStart: dto.workStart } : {}),
      ...(dto.graceMinutes !== undefined ? { graceMinutes: dto.graceMinutes } : {}),
      ...(dto.workEnd !== undefined ? { workEnd: dto.workEnd } : {}),
      ...(dto.weekendDays !== undefined ? { weekendDays: dto.weekendDays } : {}),
    };

    const finalWorkStart =
      (updatedSettings.workStart as string) || DEFAULT_SCHEDULE_SETTINGS.workStart;
    const finalWorkEnd =
      (updatedSettings.workEnd as string) || DEFAULT_SCHEDULE_SETTINGS.workEnd;

    if (finalWorkStart >= finalWorkEnd) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'workStart must be earlier than workEnd',
        details: [
          {
            field: 'workEnd',
            message: 'workEnd must be later than workStart',
          },
        ],
      });
    }

    const updatedOrg = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        settings: updatedSettings as Prisma.InputJsonValue,
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
      },
    });

    // Write audit log entry
    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorUserId: caller.userId,
        action: 'organization.settings.updated',
        entityType: 'organization',
        entityId: organizationId,
        metadata: {
          previous: {
            ...currentSettings,
            timezone: org.timezone,
          },
          updated: {
            ...updatedSettings,
            timezone: updatedOrg.timezone,
          },
        } as Prisma.InputJsonValue,
      },
    });

    return {
      workStart: updatedSettings.workStart as string,
      graceMinutes: updatedSettings.graceMinutes as number,
      workEnd: updatedSettings.workEnd as string,
      weekendDays: updatedSettings.weekendDays as number[],
      timezone: updatedOrg.timezone,
      name: updatedOrg.name,
      slug: updatedOrg.slug,
    };
  }
}
