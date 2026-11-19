import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../database/prisma.service.js';

describe('AuthService', () => {
  let authService: AuthService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      organization: {
        findUnique: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      userSession: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      rolePermission: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    authService = new AuthService(mockPrisma as unknown as PrismaService);
  });

  describe('login', () => {
    it('throws INVALID_CREDENTIALS if organization is not found', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        authService.login({ username: 'admin', password: 'Password123!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws INVALID_CREDENTIALS if user is not found', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', slug: 'bistech' });
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        authService.login({ username: 'admin', password: 'Password123!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws ACCOUNT_LOCKED if user is currently locked', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', slug: 'bistech' });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        lockedUntil: new Date(Date.now() + 10 * 60 * 1000),
        accountStatus: 'active',
      });

      await expect(
        authService.login({ username: 'admin', password: 'Password123!' }),
      ).rejects.toThrowError(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'ACCOUNT_LOCKED' }),
        }),
      );
    });

    it('locks account and throws ACCOUNT_LOCKED on 5th failed attempt', async () => {
      const hash = await argon2.hash('CorrectPassword123!');
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', slug: 'bistech' });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        passwordHash: hash,
        failedLoginCount: 4,
        lockedUntil: null,
        accountStatus: 'active',
      });
      mockPrisma.user.update.mockResolvedValue({});

      await expect(
        authService.login({ username: 'admin', password: 'WrongPassword!' }),
      ).rejects.toThrowError(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'ACCOUNT_LOCKED' }),
        }),
      );

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            failedLoginCount: 5,
            lockedUntil: expect.any(Date),
          }),
        }),
      );
    });

    it('succeeds with valid credentials, resets lockout, and returns session data', async () => {
      const hash = await argon2.hash('Password123!');
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', slug: 'bistech' });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        displayName: 'Admin User',
        email: 'admin@bistech.io',
        passwordHash: hash,
        failedLoginCount: 1,
        lockedUntil: null,
        accountStatus: 'active',
        employee: null,
        userRoles: [
          {
            role: { id: 'role-1', name: 'super_admin' },
          },
        ],
      });
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.userSession.create.mockResolvedValue({
        id: 'session-1',
      });
      mockPrisma.rolePermission.findMany.mockResolvedValue([
        {
          scope: 'org',
          permission: { key: 'user.read' },
        },
      ]);

      const result = await authService.login({
        username: 'admin',
        password: 'Password123!',
      });

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.csrfToken).toBeDefined();
      expect(result.authMeData.user.username).toBe('admin');
      expect(result.authMeData.roles).toEqual(['super_admin']);
      expect(result.authMeData.permissions).toEqual({ 'user.read': 'org' });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: expect.any(Date),
        },
      });
    });
  });

  describe('refresh', () => {
    it('detects token reuse and revokes entire session family', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue({
        id: 'session-1',
        familyId: 'family-123',
        rotatedAt: new Date(),
        revokedAt: null,
        user: { accountStatus: 'active', userRoles: [] },
      });
      mockPrisma.userSession.updateMany.mockResolvedValue({});

      await expect(
        authService.refresh('some-used-token'),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'family-123' },
        data: expect.objectContaining({
          revokedReason: 'reuse_detected',
        }),
      });
    });
  });
});
