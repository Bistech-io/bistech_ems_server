import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException, UnprocessableEntityException, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { AUTH_CONSTANTS } from './auth.constants.js';

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
        findFirst: vi.fn(),
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
      otpChallenge: {
        findFirst: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      authToken: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn((callback: any) => callback(mockPrisma)),
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

    it('orders roles by highest priority so promoted dept_head precedes employee', async () => {
      const hash = await argon2.hash('Password123!');
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', slug: 'bistech' });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-dh',
        username: 'demo_dept_head',
        displayName: 'Demo Department Head',
        email: 'dh@bistech.io',
        passwordHash: hash,
        failedLoginCount: 0,
        lockedUntil: null,
        accountStatus: 'active',
        employee: { id: 'emp-dh' },
        userRoles: [
          { role: { id: 'r-emp', name: 'employee' } },
          { role: { id: 'r-dh', name: 'dept_head' } },
        ],
      });
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.userSession.create.mockResolvedValue({ id: 'session-dh' });
      mockPrisma.rolePermission.findMany.mockResolvedValue([]);

      const result = await authService.login({
        username: 'demo_dept_head',
        password: 'Password123!',
      });

      expect(result.authMeData.roles).toEqual(['dept_head', 'employee']);
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

  describe('forgotPassword', () => {
    it('returns generic 202 message when org does not exist (anti-enumeration)', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      const result = await authService.forgotPassword({ email: 'unknown@bistech.com' });
      expect(result.message).toContain('If the account exists');
      expect(mockPrisma.otpChallenge.create).not.toHaveBeenCalled();
    });

    it('returns generic 202 message when user does not exist (anti-enumeration)', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', slug: 'bistech' });
      mockPrisma.user.findFirst = vi.fn().mockResolvedValue(null);

      const result = await authService.forgotPassword({ email: 'unknown@bistech.com' });
      expect(result.message).toContain('If the account exists');
      expect(mockPrisma.otpChallenge.create).not.toHaveBeenCalled();
    });

    it('creates OTP challenge when user exists', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', slug: 'bistech' });
      mockPrisma.user.findFirst = vi.fn().mockResolvedValue({
        id: 'user-1',
        organizationId: 'org-1',
        email: 'user@bistech.com',
        accountStatus: 'active',
      });
      mockPrisma.otpChallenge.findFirst.mockResolvedValue(null); // No cooldown hit
      mockPrisma.otpChallenge.count.mockResolvedValue(0); // Hourly count below limit
      mockPrisma.otpChallenge.updateMany.mockResolvedValue({});
      mockPrisma.otpChallenge.create.mockResolvedValue({});

      const result = await authService.forgotPassword({ email: 'user@bistech.com' });
      expect(result.message).toContain('If the account exists');
      expect(mockPrisma.otpChallenge.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            purpose: 'password_reset',
          }),
        }),
      );
    });

    it('respects 60s cooldown and does not create multiple challenges', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', slug: 'bistech' });
      mockPrisma.user.findFirst = vi.fn().mockResolvedValue({
        id: 'user-1',
        organizationId: 'org-1',
        email: 'user@bistech.com',
        accountStatus: 'active',
      });
      mockPrisma.otpChallenge.findFirst.mockResolvedValue({ id: 'recent-otp' }); // Cooldown active

      const result = await authService.forgotPassword({ email: 'user@bistech.com' });
      expect(result.message).toContain('If the account exists');
      expect(mockPrisma.otpChallenge.create).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    it('throws OTP_INVALID if user is not found', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', slug: 'bistech' });
      mockPrisma.user.findFirst = vi.fn().mockResolvedValue(null);

      await expect(
        authService.verifyOtp({ email: 'nobody@bistech.com', otp: '123456' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws OTP_INVALID on wrong OTP code and increments attempts', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', slug: 'bistech' });
      mockPrisma.user.findFirst = vi.fn().mockResolvedValue({
        id: 'user-1',
        organizationId: 'org-1',
        email: 'user@bistech.com',
      });

      const actualHash = crypto
        .createHmac('sha256', AUTH_CONSTANTS.JWT_SECRET)
        .update('654321')
        .digest('hex');

      mockPrisma.otpChallenge.findFirst.mockResolvedValue({
        id: 'challenge-1',
        codeHash: actualHash,
        attempts: 1,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 60000),
      });

      await expect(
        authService.verifyOtp({ email: 'user@bistech.com', otp: '000000' }),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(mockPrisma.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'challenge-1' },
        data: { attempts: 2, consumedAt: null },
      });
    });

    it('consumes OTP challenge and returns reset token on correct OTP', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org-1', slug: 'bistech' });
      mockPrisma.user.findFirst = vi.fn().mockResolvedValue({
        id: 'user-1',
        organizationId: 'org-1',
        email: 'user@bistech.com',
      });

      const correctOtp = '123456';
      const actualHash = crypto
        .createHmac('sha256', AUTH_CONSTANTS.JWT_SECRET)
        .update(correctOtp)
        .digest('hex');

      mockPrisma.otpChallenge.findFirst.mockResolvedValue({
        id: 'challenge-1',
        codeHash: actualHash,
        attempts: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 60000),
      });

      mockPrisma.authToken.create.mockResolvedValue({});

      const result = await authService.verifyOtp({
        email: 'user@bistech.com',
        otp: correctOtp,
      });

      expect(result.resetToken).toBeDefined();
      expect(typeof result.resetToken).toBe('string');
      expect(mockPrisma.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'challenge-1' },
        data: { consumedAt: expect.any(Date) },
      });
      expect(mockPrisma.authToken.create).toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('throws UNAUTHORIZED if reset token is missing', async () => {
      await expect(
        authService.resetPassword({ newPassword: 'BrandNewPassword123!' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws INVALID_TOKEN if reset token does not exist or expired', async () => {
      mockPrisma.authToken.findUnique.mockResolvedValue(null);

      await expect(
        authService.resetPassword(
          { newPassword: 'BrandNewPassword123!' },
          'invalid-raw-token',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('resets password, updates user, marks token used, and revokes sessions', async () => {
      const rawToken = 'valid-reset-token-1234567890';
      mockPrisma.authToken.findUnique.mockResolvedValue({
        id: 'token-1',
        organizationId: 'org-1',
        userId: 'user-1',
        purpose: 'password_reset',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60000),
      });

      const result = await authService.resetPassword(
        { newPassword: 'BrandNewPassword123!' },
        rawToken,
      );

      expect(result.message).toContain('Password reset successfully');
      expect(mockPrisma.authToken.update).toHaveBeenCalledWith({
        where: { id: 'token-1' },
        data: { usedAt: expect.any(Date) },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          failedLoginCount: 0,
          lockedUntil: null,
          accountStatus: 'active',
        }),
      });
      expect(mockPrisma.userSession.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          userId: 'user-1',
          revokedAt: null,
        },
        data: expect.objectContaining({
          revokedReason: 'user_revoke',
        }),
      });
    });

    it('resets password for authenticated user (first-login/logged-in session)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: 'org-1',
        accountStatus: 'active',
      });

      const callerUser = {
        userId: 'user-1',
        organizationId: 'org-1',
        sessionId: 'a0000000-0000-0000-0000-000000000001',
        roles: ['employee'],
      };

      const result = await authService.resetPassword(
        { newPassword: 'BrandNewPassword123!' },
        undefined,
        callerUser,
      );

      expect(result.message).toContain('Password reset successfully');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          failedLoginCount: 0,
          lockedUntil: null,
          accountStatus: 'active',
        }),
      });
      expect(mockPrisma.userSession.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          userId: 'user-1',
          id: { not: 'a0000000-0000-0000-0000-000000000001' },
          revokedAt: null,
        },
        data: expect.objectContaining({
          revokedReason: 'password_reset',
        }),
      });
    });

    it('validates currentPassword in resetPassword when provided for authenticated user', async () => {
      const oldHash = await argon2.hash('OldPassword123!', { type: argon2.argon2id });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: 'org-1',
        passwordHash: oldHash,
        accountStatus: 'active',
      });

      const callerUser = {
        userId: 'user-1',
        organizationId: 'org-1',
        sessionId: 'a0000000-0000-0000-0000-000000000001',
        roles: ['employee'],
      };

      // Fails with wrong currentPassword
      await expect(
        authService.resetPassword(
          { currentPassword: 'WrongPassword!', newPassword: 'BrandNewPassword123!' },
          undefined,
          callerUser,
        ),
      ).rejects.toThrow(BadRequestException);

      // Succeeds with correct currentPassword
      const result = await authService.resetPassword(
        { currentPassword: 'OldPassword123!', newPassword: 'BrandNewPassword123!' },
        undefined,
        callerUser,
      );
      expect(result.message).toContain('Password reset successfully');
    });
  });

  describe('changePassword', () => {
    it('successfully changes password when currentPassword is correct', async () => {
      const oldHash = await argon2.hash('CurrentSecret123!', { type: argon2.argon2id });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: 'org-1',
        username: 'johndoe',
        name: 'John Doe',
        email: 'john@bistech.com',
        passwordHash: oldHash,
        accountStatus: 'active',
      });

      const callerUser = {
        userId: 'user-1',
        organizationId: 'org-1',
        sessionId: 'a0000000-0000-0000-0000-000000000001',
        roles: ['employee'],
      };

      const result = await authService.changePassword(
        {
          currentPassword: 'CurrentSecret123!',
          newPassword: 'BrandNewSuperSecurePass456!',
        },
        callerUser,
      );

      expect(result.message).toBe('Password changed successfully');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          failedLoginCount: 0,
          lockedUntil: null,
          accountStatus: 'active',
        }),
      });
      expect(mockPrisma.userSession.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          userId: 'user-1',
          id: { not: 'a0000000-0000-0000-0000-000000000001' },
          revokedAt: null,
        },
        data: expect.objectContaining({
          revokedReason: 'password_reset',
        }),
      });
    });

    it('rejects with INVALID_CREDENTIALS when current password is incorrect', async () => {
      const oldHash = await argon2.hash('CurrentSecret123!', { type: argon2.argon2id });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: 'org-1',
        username: 'johndoe',
        passwordHash: oldHash,
        accountStatus: 'active',
      });

      const callerUser = {
        userId: 'user-1',
        organizationId: 'org-1',
        sessionId: 'a0000000-0000-0000-0000-000000000001',
        roles: ['employee'],
      };

      await expect(
        authService.changePassword(
          {
            currentPassword: 'WrongPassword!',
            newPassword: 'BrandNewSuperSecurePass456!',
          },
          callerUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when new password matches current password', async () => {
      const oldHash = await argon2.hash('CurrentSecret123!', { type: argon2.argon2id });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: 'org-1',
        username: 'johndoe',
        passwordHash: oldHash,
        accountStatus: 'active',
      });

      const callerUser = {
        userId: 'user-1',
        organizationId: 'org-1',
        sessionId: 'a0000000-0000-0000-0000-000000000001',
        roles: ['employee'],
      };

      await expect(
        authService.changePassword(
          {
            currentPassword: 'CurrentSecret123!',
            newPassword: 'CurrentSecret123!',
          },
          callerUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when new password contains user identity tokens', async () => {
      const oldHash = await argon2.hash('CurrentSecret123!', { type: argon2.argon2id });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        organizationId: 'org-1',
        username: 'johndoe',
        name: 'John Doe',
        email: 'john@bistech.com',
        passwordHash: oldHash,
        accountStatus: 'active',
      });

      const callerUser = {
        userId: 'user-1',
        organizationId: 'org-1',
        sessionId: 'a0000000-0000-0000-0000-000000000001',
        roles: ['employee'],
      };

      await expect(
        authService.changePassword(
          {
            currentPassword: 'CurrentSecret123!',
            newPassword: 'SecretJohnPass123!',
          },
          callerUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
