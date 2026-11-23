import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OrganizationService,
  type OrganizationSettingsData,
} from './organization.service.js';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { PrismaService } from '../database/prisma.service.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';

describe('OrganizationService', () => {
  let service: OrganizationService;
  let mockPrisma: any;

  const mockOrg = {
    id: 'org-uuid-1',
    name: 'BisTech',
    slug: 'bistech',
    timezone: 'Asia/Dhaka',
    settings: {
      workStart: '10:00',
      graceMinutes: 15,
      workEnd: '18:30',
      weekendDays: [5, 6],
    },
  };

  const adminCaller: AuthenticatedUser = {
    userId: 'user-admin-uuid',
    organizationId: 'org-uuid-1',
    sessionId: 'session-1',
    roles: ['super_admin'],
  };

  const hrCaller: AuthenticatedUser = {
    userId: 'user-hr-uuid',
    organizationId: 'org-uuid-1',
    sessionId: 'session-2',
    roles: ['hr_manager'],
  };

  const employeeCaller: AuthenticatedUser = {
    userId: 'user-emp-uuid',
    organizationId: 'org-uuid-1',
    sessionId: 'session-3',
    roles: ['employee'],
  };

  beforeEach(() => {
    mockPrisma = {
      organization: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };

    service = new OrganizationService(mockPrisma as unknown as PrismaService);
  });

  describe('getSettings', () => {
    it('returns settings correctly for valid organization', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(mockOrg);

      const result = await service.getSettings('org-uuid-1');

      expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: 'org-uuid-1' },
      });
      expect(result).toEqual({
        workStart: '10:00',
        graceMinutes: 15,
        workEnd: '18:30',
        weekendDays: [5, 6],
        timezone: 'Asia/Dhaka',
        name: 'BisTech',
        slug: 'bistech',
      });
    });

    it('throws NotFoundException if organization does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.getSettings('non-existent-org')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateSettings', () => {
    it('allows super_admin to update settings and logs audit', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(mockOrg);
      mockPrisma.organization.update.mockResolvedValue({
        ...mockOrg,
        settings: {
          workStart: '09:00',
          graceMinutes: 20,
          workEnd: '18:00',
          weekendDays: [5, 6],
        },
      });

      const result = await service.updateSettings(
        'org-uuid-1',
        {
          workStart: '09:00',
          graceMinutes: 20,
          workEnd: '18:00',
        },
        adminCaller,
      );

      expect(result.workStart).toBe('09:00');
      expect(result.graceMinutes).toBe(20);
      expect(result.workEnd).toBe('18:00');
      expect(result.weekendDays).toEqual([5, 6]);

      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-uuid-1' },
        data: {
          settings: {
            workStart: '09:00',
            graceMinutes: 20,
            workEnd: '18:00',
            weekendDays: [5, 6],
          },
        },
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-uuid-1',
          actorUserId: 'user-admin-uuid',
          action: 'organization.settings.updated',
          entityType: 'organization',
          entityId: 'org-uuid-1',
        }),
      });
    });

    it('allows hr_manager to update settings', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(mockOrg);
      mockPrisma.organization.update.mockResolvedValue({
        ...mockOrg,
        settings: {
          workStart: '10:00',
          graceMinutes: 10,
          workEnd: '18:30',
          weekendDays: [6, 7],
        },
      });

      const result = await service.updateSettings(
        'org-uuid-1',
        {
          graceMinutes: 10,
          weekendDays: [6, 7],
        },
        hrCaller,
      );

      expect(result.graceMinutes).toBe(10);
      expect(result.weekendDays).toEqual([6, 7]);
      expect(mockPrisma.organization.update).toHaveBeenCalled();
    });

    it('rejects update from regular employee with ForbiddenException', async () => {
      await expect(
        service.updateSettings('org-uuid-1', { graceMinutes: 30 }, employeeCaller),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.organization.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException if workStart is not earlier than workEnd', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(mockOrg);

      await expect(
        service.updateSettings(
          'org-uuid-1',
          {
            workStart: '19:00',
            workEnd: '18:00',
          },
          adminCaller,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.organization.update).not.toHaveBeenCalled();
    });
  });
});

