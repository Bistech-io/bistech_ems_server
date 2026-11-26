import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrganizationController } from './organization.controller.js';
import { BadRequestException } from '@nestjs/common';
import type { OrganizationService } from './organization.service.js';
import type { Request } from 'express';

describe('OrganizationController', () => {
  let controller: OrganizationController;
  let mockService: any;

  const mockSettingsData = {
    workStart: '10:00',
    graceMinutes: 15,
    workEnd: '18:30',
    weekendDays: [5, 6],
    timezone: 'Asia/Dhaka',
    name: 'BisTech',
    slug: 'bistech',
    allowedOfficeIps: [],
    ipRestrictionEnabled: false,
    currentIp: '203.0.113.10',
  };

  const mockReq = {
    headers: { 'x-forwarded-for': '203.0.113.10' },
    ip: '203.0.113.10',
    user: {
      userId: 'user-1',
      organizationId: 'org-1',
      sessionId: 'session-1',
      roles: ['super_admin'],
    },
  } as unknown as Request;

  beforeEach(() => {
    mockService = {
      getSettings: vi.fn().mockResolvedValue(mockSettingsData),
      updateSettings: vi.fn(),
    };

    controller = new OrganizationController(
      mockService as unknown as OrganizationService,
    );
  });

  describe('getSettings', () => {
    it('returns organization settings envelope', async () => {
      const response = await controller.getSettings(mockReq);

      expect(mockService.getSettings).toHaveBeenCalledWith(
        'org-1',
        mockReq.user,
        '203.0.113.10',
      );
      expect(response).toEqual({
        success: true,
        message: 'Organization settings retrieved',
        data: mockSettingsData,
        meta: null,
      });
    });
  });

  describe('updateSettings', () => {
    it('validates payload and updates settings', async () => {
      const updatedData = {
        ...mockSettingsData,
        workStart: '09:00',
        workEnd: '17:30',
      };
      mockService.updateSettings.mockResolvedValue(updatedData);

      const response = await controller.updateSettings(
        {
          workStart: '09:00',
          workEnd: '17:30',
        },
        mockReq,
      );

      expect(mockService.updateSettings).toHaveBeenCalledWith(
        'org-1',
        {
          workStart: '09:00',
          workEnd: '17:30',
        },
        mockReq.user,
        '203.0.113.10',
      );
      expect(response).toEqual({
        success: true,
        message: 'Organization settings updated successfully',
        data: updatedData,
        meta: null,
      });
    });

    it('validates payload and updates settings including timezone and 180 min grace period', async () => {
      const updatedData = {
        ...mockSettingsData,
        workStart: '10:00',
        workEnd: '18:30',
        graceMinutes: 180,
        timezone: 'Asia/Dhaka',
      };
      mockService.updateSettings.mockResolvedValue(updatedData);

      const response = await controller.updateSettings(
        {
          workStart: '10:00',
          workEnd: '18:30',
          graceMinutes: 180,
          timezone: 'Asia/Dhaka',
        },
        mockReq,
      );

      expect(mockService.updateSettings).toHaveBeenCalledWith(
        'org-1',
        {
          workStart: '10:00',
          workEnd: '18:30',
          graceMinutes: 180,
          timezone: 'Asia/Dhaka',
        },
        mockReq.user,
        '203.0.113.10',
      );
      expect(response).toEqual({
        success: true,
        message: 'Organization settings updated successfully',
        data: updatedData,
        meta: null,
      });
    });

    it('validates and deduplicates allowedOfficeIps entries', async () => {
      const updatedData = {
        ...mockSettingsData,
        allowedOfficeIps: ['203.0.113.10', '103.45.20.0/24'],
        ipRestrictionEnabled: true,
      };
      mockService.updateSettings.mockResolvedValue(updatedData);

      const response = await controller.updateSettings(
        {
          allowedOfficeIps: [' 203.0.113.10 ', '203.0.113.10', '103.45.20.0/24'],
        },
        mockReq,
      );

      expect(mockService.updateSettings).toHaveBeenCalledWith(
        'org-1',
        {
          allowedOfficeIps: ['203.0.113.10', '103.45.20.0/24'],
        },
        mockReq.user,
        '203.0.113.10',
      );
      expect(response.data.allowedOfficeIps).toEqual(['203.0.113.10', '103.45.20.0/24']);
    });

    it('throws BadRequestException on invalid office IP entry', async () => {
      await expect(
        controller.updateSettings(
          {
            allowedOfficeIps: ['999.999.1.1'],
          },
          mockReq,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockService.updateSettings).not.toHaveBeenCalled();
    });

    it('throws BadRequestException on invalid timezone', async () => {
      await expect(
        controller.updateSettings(
          {
            timezone: 'Invalid/City_Region_123',
          },
          mockReq,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockService.updateSettings).not.toHaveBeenCalled();
    });

    it('throws BadRequestException on invalid time format', async () => {
      await expect(
        controller.updateSettings(
          {
            workStart: '9:00', // missing leading zero
          },
          mockReq,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockService.updateSettings).not.toHaveBeenCalled();
    });

    it('throws BadRequestException on duplicate weekend days', async () => {
      await expect(
        controller.updateSettings(
          {
            weekendDays: [5, 5],
          },
          mockReq,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockService.updateSettings).not.toHaveBeenCalled();
    });

    it('throws BadRequestException on negative grace minutes', async () => {
      await expect(
        controller.updateSettings(
          {
            graceMinutes: -5,
          },
          mockReq,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockService.updateSettings).not.toHaveBeenCalled();
    });
  });
});

