import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { hasPermission } from '../auth/permission.utils.js';
import type { UpdateOrganizationSettingsDto } from './dto/update-settings.dto.js';

export interface OrganizationSettingsData {
  workStart: string;
  graceMinutes: number;
  workEnd: string;
  weekendDays: number[];
  timezone: string;
  name: string;
  slug: string;
  allowedOfficeIps: string[];
  ipRestrictionEnabled: boolean;
  currentIp: string | null;
}

const DEFAULT_SCHEDULE_SETTINGS = {
  workStart: '10:00',
  graceMinutes: 15,
  workEnd: '18:30',
  weekendDays: [5, 6],
};

const ORG_SECURITY_ADMIN_ROLES = new Set([
  'super_admin',
  'admin',
  'hr_manager',
  'hr',
]);

function canManageOrganizationSettings(caller: AuthenticatedUser): boolean {
  if (hasPermission(caller, 'org.settings.manage', 'org')) {
    return true;
  }
  return caller.roles.some((role) =>
    ORG_SECURITY_ADMIN_ROLES.has(role.trim().toLowerCase()),
  );
}

function isMissingAllowedOfficeIpsColumnError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const record = err as { code?: unknown; message?: unknown };
  if (record.code === 'P2022') return true;
  return (
    typeof record.message === 'string' &&
    record.message.includes('allowed_office_ips')
  );
}

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureAllowedOfficeIpsColumn(): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "allowed_office_ips" TEXT[] NOT NULL DEFAULT '{}'::text[]`,
    );
  }

  private async findOrgWithIpFallback(organizationId: string) {
    try {
      return await this.prisma.organization.findUnique({
        where: { id: organizationId },
      });
    } catch (err) {
      if (!isMissingAllowedOfficeIpsColumnError(err)) throw err;
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          slug: true,
          timezone: true,
          settings: true,
        },
      });
      return org ? { ...org, allowedOfficeIps: [] as string[] } : null;
    }
  }

  async getSettings(
    organizationId: string,
    caller?: AuthenticatedUser,
    clientIp: string | null = null,
  ): Promise<OrganizationSettingsData> {
    const org = await this.findOrgWithIpFallback(organizationId);

    if (!org) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Organization not found',
      });
    }

    const rawSettings = (org.settings as Record<string, unknown>) || {};
    const storedIps = Array.isArray(org.allowedOfficeIps) ? org.allowedOfficeIps : [];
    const canViewIps = !caller || canManageOrganizationSettings(caller);

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
      allowedOfficeIps: canViewIps ? storedIps : [],
      ipRestrictionEnabled: storedIps.length > 0,
      currentIp: canViewIps ? clientIp : null,
    };
  }

  async updateSettings(
    organizationId: string,
    dto: UpdateOrganizationSettingsDto,
    caller: AuthenticatedUser,
    clientIp: string | null = null,
  ): Promise<OrganizationSettingsData> {
    if (!canManageOrganizationSettings(caller)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to update organization settings',
      });
    }

    const org = await this.findOrgWithIpFallback(organizationId);

    if (!org) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Organization not found',
      });
    }

    const currentSettings = (org.settings as Record<string, unknown>) || {};
    const currentAllowedIps = Array.isArray(org.allowedOfficeIps)
      ? org.allowedOfficeIps
      : [];
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

    const updateData: Prisma.OrganizationUpdateInput = {
      settings: updatedSettings as Prisma.InputJsonValue,
      ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
      ...(dto.allowedOfficeIps !== undefined
        ? { allowedOfficeIps: dto.allowedOfficeIps }
        : {}),
    };

    let updatedOrg: {
      timezone: string;
      name: string;
      slug: string;
      allowedOfficeIps?: string[];
    };

    try {
      updatedOrg = await this.prisma.organization.update({
        where: { id: organizationId },
        data: updateData,
      });
    } catch (err) {
      if (!isMissingAllowedOfficeIpsColumnError(err)) throw err;
      await this.ensureAllowedOfficeIpsColumn();
      updatedOrg = await this.prisma.organization.update({
        where: { id: organizationId },
        data: updateData,
      });
    }

    const finalAllowedIps = Array.isArray(updatedOrg.allowedOfficeIps)
      ? updatedOrg.allowedOfficeIps
      : dto.allowedOfficeIps ?? currentAllowedIps;

    // Write audit log entry
    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorUserId: caller.userId,
        action: 'organization.settings.updated',
        entityType: 'organization',
        entityId: organizationId,
        ipAddress: clientIp ?? undefined,
        metadata: {
          previous: {
            ...currentSettings,
            timezone: org.timezone,
            ...(dto.allowedOfficeIps !== undefined
              ? { allowedOfficeIps: currentAllowedIps }
              : {}),
          },
          updated: {
            ...updatedSettings,
            timezone: updatedOrg.timezone,
            ...(dto.allowedOfficeIps !== undefined
              ? { allowedOfficeIps: finalAllowedIps }
              : {}),
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
      allowedOfficeIps: finalAllowedIps,
      ipRestrictionEnabled: finalAllowedIps.length > 0,
      currentIp: clientIp,
    };
  }
}
