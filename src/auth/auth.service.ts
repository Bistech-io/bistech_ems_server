import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as argon2 from 'argon2';
import * as jose from 'jose';
import { RevokedReason } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { AUTH_CONSTANTS } from './auth.constants.js';
import type { AuthenticatedUser } from './auth.guard.js';
import { LoginDto } from './dto/login.dto.js';
import {
  ForgotPasswordDto,
  VerifyOtpDto,
  ResetPasswordDto,
} from './dto/reset-password.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';

export interface UserAuthMeData {
  user: {
    id: string;
    username: string;
    email?: string;
    name: string;
    accountStatus: string;
  };
  employeeId: string | null;
  roles: string[];
  permissions: Record<string, string>;
  csrfToken: string;
}

@Injectable()
export class AuthService {
  private readonly jwtSecretBytes = new TextEncoder().encode(AUTH_CONSTANTS.JWT_SECRET);

  constructor(private readonly prisma: PrismaService) {}

  async login(
    dto: LoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    csrfToken: string;
    authMeData: UserAuthMeData;
  }> {
    const username = dto.username.trim().toLowerCase();
    const orgSlug = dto.organizationSlug?.trim().toLowerCase() || 'bistech';

    // 1. Resolve organization
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
    });

    if (!org) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password',
      });
    }

    // 2. Query user by (organizationId, username)
    const user = await this.prisma.user.findUnique({
      where: {
        organizationId_username: {
          organizationId: org.id,
          username,
        },
      },
      include: {
        employee: true,
        userRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password',
      });
    }

    // 3. Lockout check
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_LOCKED',
        message: 'Account temporarily locked due to multiple failed login attempts. Please try again later.',
      });
    }

    if (user.accountStatus !== 'active' || !user.passwordHash) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password',
      });
    }

    // 4. Verify password
    let passwordMatches = false;
    try {
      passwordMatches = await argon2.verify(user.passwordHash, dto.password);
    } catch {
      passwordMatches = false;
    }

    if (!passwordMatches) {
      const nextFailedCount = user.failedLoginCount + 1;
      const isLocking = nextFailedCount >= AUTH_CONSTANTS.MAX_FAILED_LOGIN_ATTEMPTS;
      const lockedUntil = isLocking
        ? new Date(Date.now() + AUTH_CONSTANTS.LOCKOUT_DURATION_MS)
        : null;

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: nextFailedCount,
          lockedUntil,
        },
      });

      if (isLocking) {
        throw new UnauthorizedException({
          code: 'ACCOUNT_LOCKED',
          message: 'Account temporarily locked due to multiple failed login attempts. Please try again later.',
        });
      }

      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password',
      });
    }

    // 5. Reset lockout & update lastLoginAt on success
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    // 6. Create session
    const rawRefreshToken = crypto.randomBytes(32).toString('hex');
    const refreshTokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const familyId = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + AUTH_CONSTANTS.COOKIE_REFRESH_MAX_AGE_MS);
    const absoluteExpiresAt = new Date(
      now.getTime() + AUTH_CONSTANTS.ABSOLUTE_SESSION_DAYS * 24 * 60 * 60 * 1000,
    );

    const session = await this.prisma.userSession.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        familyId,
        refreshTokenHash,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        expiresAt,
        absoluteExpiresAt,
      },
    });

    // 7. Generate CSRF token & Access Token
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const roleNames = user.userRoles.map((ur) => ur.role.name);
    const roleIds = user.userRoles.map((ur) => ur.role.id);

    const accessToken = await this.signAccessToken({
      sub: user.id,
      orgId: org.id,
      sessionId: session.id,
      roles: roleNames,
    });

    // 8. Build Permissions map
    const permissions = await this.resolvePermissionsForRoles(roleIds);

    const authMeData: UserAuthMeData = {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.displayName,
        accountStatus: user.accountStatus,
      },
      employeeId: user.employee?.id ?? null,
      roles: roleNames,
      permissions,
      csrfToken,
    };

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      csrfToken,
      authMeData,
    };
  }

  async refresh(
    rawRefreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    csrfToken: string;
    authMeData: UserAuthMeData;
  }> {
    if (!rawRefreshToken) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Refresh token is required',
      });
    }

    const refreshTokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash },
      include: {
        user: {
          include: {
            employee: true,
            userRoles: {
              include: {
                role: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Invalid refresh token',
      });
    }

    // Reuse detection: if this session was already rotated or revoked, invalidate entire family!
    if (session.revokedAt || session.rotatedAt) {
      await this.prisma.userSession.updateMany({
        where: { familyId: session.familyId },
        data: {
          revokedAt: new Date(),
          revokedReason: RevokedReason.reuse_detected,
        },
      });
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Session revoked due to token reuse detection',
      });
    }

    const now = new Date();
    if (session.expiresAt < now || session.absoluteExpiresAt < now) {
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: {
          revokedAt: now,
          revokedReason: RevokedReason.logout,
        },
      });
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Session has expired',
      });
    }

    if (session.user.accountStatus !== 'active') {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'User account is not active',
      });
    }

    // Mark current session rotated
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { rotatedAt: now },
    });

    // Create new session in same family
    const newRawRefreshToken = crypto.randomBytes(32).toString('hex');
    const newRefreshTokenHash = crypto.createHash('sha256').update(newRawRefreshToken).digest('hex');
    const newExpiresAt = new Date(now.getTime() + AUTH_CONSTANTS.COOKIE_REFRESH_MAX_AGE_MS);
    // Bounded by absoluteExpiresAt
    const finalExpiresAt = newExpiresAt < session.absoluteExpiresAt ? newExpiresAt : session.absoluteExpiresAt;

    const newSession = await this.prisma.userSession.create({
      data: {
        organizationId: session.organizationId,
        userId: session.userId,
        familyId: session.familyId,
        refreshTokenHash: newRefreshTokenHash,
        ipAddress: ipAddress || session.ipAddress,
        userAgent: userAgent || session.userAgent,
        expiresAt: finalExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
      },
    });

    const csrfToken = crypto.randomBytes(24).toString('hex');
    const roleNames = session.user.userRoles.map((ur) => ur.role.name);
    const roleIds = session.user.userRoles.map((ur) => ur.role.id);

    const accessToken = await this.signAccessToken({
      sub: session.user.id,
      orgId: session.organizationId,
      sessionId: newSession.id,
      roles: roleNames,
    });

    const permissions = await this.resolvePermissionsForRoles(roleIds);

    const authMeData: UserAuthMeData = {
      user: {
        id: session.user.id,
        username: session.user.username,
        email: session.user.email,
        name: session.user.displayName,
        accountStatus: session.user.accountStatus,
      },
      employeeId: session.user.employee?.id ?? null,
      roles: roleNames,
      permissions,
      csrfToken,
    };

    return {
      accessToken,
      refreshToken: newRawRefreshToken,
      csrfToken,
      authMeData,
    };
  }

  async logout(rawRefreshToken?: string): Promise<void> {
    if (!rawRefreshToken) return;

    const refreshTokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash },
    });

    if (session && !session.revokedAt) {
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: {
          revokedAt: new Date(),
          revokedReason: RevokedReason.logout,
        },
      });
    }
  }

  async getMe(userId: string, organizationId: string, csrfToken: string): Promise<UserAuthMeData> {
    const user = await this.prisma.user.findUnique({
      where: {
        organizationId_id: {
          organizationId,
          id: userId,
        },
      },
      include: {
        employee: true,
        userRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user || user.accountStatus !== 'active') {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'User session invalid',
      });
    }

    const roleNames = user.userRoles.map((ur) => ur.role.name);
    const roleIds = user.userRoles.map((ur) => ur.role.id);
    const permissions = await this.resolvePermissionsForRoles(roleIds);

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.displayName,
        accountStatus: user.accountStatus,
      },
      employeeId: user.employee?.id ?? null,
      roles: roleNames,
      permissions,
      csrfToken,
    };
  }

  async signAccessToken(payload: Record<string, unknown>): Promise<string> {
    return await new jose.SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(AUTH_CONSTANTS.JWT_EXPIRES_IN)
      .sign(this.jwtSecretBytes);
  }

  async verifyAccessToken(token: string): Promise<jose.JWTPayload & { sub: string; orgId: string; sessionId: string; roles: string[] }> {
    try {
      const { payload } = await jose.jwtVerify(token, this.jwtSecretBytes);
      return payload as any;
    } catch (err: any) {
      if (err?.code === 'ERR_JWT_EXPIRED') {
        throw new UnauthorizedException({
          code: 'TOKEN_EXPIRED',
          message: 'Access token expired',
        });
      }
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Invalid access token',
      });
    }
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
    _ipAddress?: string,
  ): Promise<{ message: string }> {
    const email = dto.email.trim().toLowerCase();
    const orgSlug = dto.organizationSlug?.trim().toLowerCase() || 'bistech';

    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
    });

    if (!org) {
      await argon2.hash('timing_equalizer_dummy', { type: argon2.argon2id });
      return { message: 'If the account exists, an OTP has been sent' };
    }

    const user = await this.prisma.user.findFirst({
      where: {
        organizationId: org.id,
        email,
        accountStatus: { in: ['active', 'invited'] },
      },
    });

    if (!user) {
      await argon2.hash('timing_equalizer_dummy', { type: argon2.argon2id });
      return { message: 'If the account exists, an OTP has been sent' };
    }

    // Check cooldown (60s)
    const recentChallenge = await this.prisma.otpChallenge.findFirst({
      where: {
        organizationId: org.id,
        userId: user.id,
        purpose: 'password_reset',
        consumedAt: null,
        createdAt: { gte: new Date(Date.now() - AUTH_CONSTANTS.OTP_COOLDOWN_MS) },
      },
    });
    if (recentChallenge) {
      return { message: 'If the account exists, an OTP has been sent' };
    }

    // Check hourly limit (max 3 per hour)
    const hourlyCount = await this.prisma.otpChallenge.count({
      where: {
        organizationId: org.id,
        userId: user.id,
        purpose: 'password_reset',
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (hourlyCount >= 3) {
      return { message: 'If the account exists, an OTP has been sent' };
    }

    // Invalidate prior unconsumed OTPs for this user
    await this.prisma.otpChallenge.updateMany({
      where: {
        organizationId: org.id,
        userId: user.id,
        purpose: 'password_reset',
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    });

    // Generate secure 6-digit OTP
    const code = crypto.randomInt(100000, 1000000).toString();
    const codeHash = crypto
      .createHmac('sha256', AUTH_CONSTANTS.JWT_SECRET)
      .update(code)
      .digest('hex');

    await this.prisma.otpChallenge.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        purpose: 'password_reset',
        codeHash,
        hmacKeyId: 'default',
        expiresAt: new Date(Date.now() + AUTH_CONSTANTS.OTP_TTL_MS),
      },
    });

    // In non-production, log code for verification and test convenience
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Dev] Password reset OTP for ${user.email}: ${code}`);
    }

    return { message: 'If the account exists, an OTP has been sent' };
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<{ resetToken: string }> {
    const email = dto.email.trim().toLowerCase();
    const orgSlug = dto.organizationSlug?.trim().toLowerCase() || 'bistech';

    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
    });

    if (!org) {
      throw new UnprocessableEntityException({
        code: 'OTP_INVALID',
        message: 'Invalid or expired OTP code',
      });
    }

    const user = await this.prisma.user.findFirst({
      where: {
        organizationId: org.id,
        email,
      },
    });

    if (!user) {
      throw new UnprocessableEntityException({
        code: 'OTP_INVALID',
        message: 'Invalid or expired OTP code',
      });
    }

    const challenge = await this.prisma.otpChallenge.findFirst({
      where: {
        organizationId: org.id,
        userId: user.id,
        purpose: 'password_reset',
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge || challenge.expiresAt < new Date()) {
      throw new UnprocessableEntityException({
        code: 'OTP_INVALID',
        message: 'Invalid or expired OTP code',
      });
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      throw new UnprocessableEntityException({
        code: 'OTP_INVALID',
        message: 'Invalid or expired OTP code',
      });
    }

    const candidateHash = crypto
      .createHmac('sha256', AUTH_CONSTANTS.JWT_SECRET)
      .update(dto.otp)
      .digest('hex');

    const matches = crypto.timingSafeEqual(
      Buffer.from(candidateHash, 'hex'),
      Buffer.from(challenge.codeHash, 'hex'),
    );

    if (!matches) {
      const nextAttempts = challenge.attempts + 1;
      const isExhausted = nextAttempts >= challenge.maxAttempts;
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: {
          attempts: nextAttempts,
          consumedAt: isExhausted ? new Date() : null,
        },
      });

      throw new UnprocessableEntityException({
        code: 'OTP_INVALID',
        message: 'Invalid or expired OTP code',
      });
    }

    // Mark challenge consumed
    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    // Issue single-use 15 min reset token
    const rawResetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawResetToken).digest('hex');

    await this.prisma.authToken.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        purpose: 'password_reset',
        tokenHash,
        expiresAt: new Date(Date.now() + AUTH_CONSTANTS.RESET_TOKEN_TTL_MS),
      },
    });

    return { resetToken: rawResetToken };
  }

  async resetPassword(
    dto: ResetPasswordDto,
    tokenFromCookie?: string,
    callerUser?: AuthenticatedUser,
  ): Promise<{ message: string }> {
    const rawToken = dto.resetToken || tokenFromCookie;

    // Flow 1: Reset via OTP token (forgot-password)
    if (rawToken) {
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const authToken = await this.prisma.authToken.findUnique({
        where: { tokenHash },
      });

      if (
        !authToken ||
        authToken.usedAt ||
        authToken.expiresAt < new Date() ||
        authToken.purpose !== 'password_reset'
      ) {
        throw new UnauthorizedException({
          code: 'INVALID_TOKEN',
          message: 'Password reset token is invalid or has expired',
        });
      }

      const user = await this.prisma.user.findUnique({
        where: { id: authToken.userId },
      });

      if (user) {
        this.validatePasswordIdentityRules(dto.newPassword, user);
      }

      const passwordHash = await argon2.hash(dto.newPassword, {
        type: argon2.argon2id,
      });

      await this.prisma.$transaction(async (tx) => {
        // 1. Consume token
        await tx.authToken.update({
          where: { id: authToken.id },
          data: { usedAt: new Date() },
        });

        // 2. Update user credentials & clear lockout
        await tx.user.update({
          where: { id: authToken.userId },
          data: {
            passwordHash,
            failedLoginCount: 0,
            lockedUntil: null,
            accountStatus: 'active',
          },
        });

        // 3. Revoke all active sessions
        await tx.userSession.updateMany({
          where: {
            organizationId: authToken.organizationId,
            userId: authToken.userId,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
            revokedReason: 'user_revoke',
          },
        });
      });

      return { message: 'Password reset successfully' };
    }

    // Flow 2: Authenticated user (first-login setup or logged-in password update)
    if (callerUser) {
      const user = await this.prisma.user.findFirst({
        where: {
          id: callerUser.userId,
          organizationId: callerUser.organizationId,
        },
      });

      if (!user) {
        throw new UnauthorizedException({
          code: 'UNAUTHENTICATED',
          message: 'User not found in organization',
        });
      }

      if (dto.currentPassword) {
        let passwordMatches = false;
        try {
          if (user.passwordHash) {
            passwordMatches = await argon2.verify(user.passwordHash, dto.currentPassword);
          }
        } catch {
          passwordMatches = false;
        }

        if (!passwordMatches) {
          throw new BadRequestException({
            code: 'INVALID_CREDENTIALS',
            message: 'Current password is incorrect',
          });
        }

        if (dto.currentPassword === dto.newPassword) {
          throw new BadRequestException({
            code: 'BAD_REQUEST',
            message: 'New password cannot be the same as your current password',
          });
        }
      }

      this.validatePasswordIdentityRules(dto.newPassword, user);

      const passwordHash = await argon2.hash(dto.newPassword, {
        type: argon2.argon2id,
      });

      await this.prisma.$transaction(async (tx) => {
        // 1. Update user credentials & clear lockout
        await tx.user.update({
          where: { id: user.id },
          data: {
            passwordHash,
            failedLoginCount: 0,
            lockedUntil: null,
            accountStatus: 'active',
          },
        });

        // 2. Revoke other sessions (if any), preserving current session for immediate operations (e.g. check-in)
        const isSessionUuid =
          callerUser.sessionId &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            callerUser.sessionId,
          );

        await tx.userSession.updateMany({
          where: {
            organizationId: callerUser.organizationId,
            userId: user.id,
            ...(isSessionUuid ? { id: { not: callerUser.sessionId } } : {}),
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
            revokedReason: 'password_reset',
          },
        });
      });

      return { message: 'Password reset successfully' };
    }

    throw new UnauthorizedException({
      code: 'UNAUTHORIZED',
      message: 'Password reset token or active session is required',
    });
  }

  async changePassword(
    dto: ChangePasswordDto,
    callerUser: AuthenticatedUser,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: callerUser.userId,
        organizationId: callerUser.organizationId,
      },
    });

    if (!user || user.accountStatus !== 'active' || !user.passwordHash) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'User not found in organization',
      });
    }

    let passwordMatches = false;
    try {
      passwordMatches = await argon2.verify(user.passwordHash, dto.currentPassword);
    } catch {
      passwordMatches = false;
    }

    if (!passwordMatches) {
      throw new BadRequestException({
        code: 'INVALID_CREDENTIALS',
        message: 'Current password is incorrect',
      });
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'New password cannot be the same as your current password',
      });
    }

    this.validatePasswordIdentityRules(dto.newPassword, user);

    const passwordHash = await argon2.hash(dto.newPassword, {
      type: argon2.argon2id,
    });

    await this.prisma.$transaction(async (tx) => {
      // 1. Update user credentials & clear lockout
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
          accountStatus: 'active',
        },
      });

      // 2. Revoke other sessions (if any), preserving current session
      const isSessionUuid =
        callerUser.sessionId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          callerUser.sessionId,
        );

      await tx.userSession.updateMany({
        where: {
          organizationId: callerUser.organizationId,
          userId: user.id,
          ...(isSessionUuid ? { id: { not: callerUser.sessionId } } : {}),
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
          revokedReason: 'password_reset',
        },
      });
    });

    return { message: 'Password changed successfully' };
  }

  private validatePasswordIdentityRules(
    newPassword: string,
    user: { username?: string | null; name?: string | null; email?: string | null },
  ) {
    const lowerPwd = newPassword.toLowerCase();
    const tokens = [user.username, user.name, user.email?.split('@')[0]]
      .filter((t): t is string => Boolean(t && t.trim().length >= 3))
      .flatMap((t) => [t.trim().toLowerCase(), ...t.trim().toLowerCase().split(/\s+/)])
      .filter((t) => t.length >= 3);

    if (tokens.some((token) => lowerPwd.includes(token))) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Password cannot contain your name, username, or email',
      });
    }
  }

  private async resolvePermissionsForRoles(roleIds: string[]): Promise<Record<string, string>> {
    if (roleIds.length === 0) return {};

    const rolePerms = await this.prisma.rolePermission.findMany({
      where: {
        roleId: { in: roleIds },
      },
      include: {
        permission: true,
      },
    });

    const SCOPE_RANKS: Record<string, number> = {
      own: 1,
      team: 2,
      department: 3,
      managed: 4,
      org: 5,
    };

    const map: Record<string, string> = {};
    for (const rp of rolePerms) {
      const key = rp.permission.key;
      const scope = rp.scope;
      const currentRank = map[key] ? SCOPE_RANKS[map[key]] || 0 : 0;
      const newRank = SCOPE_RANKS[scope] || 0;
      if (newRank > currentRank) {
        map[key] = scope;
      }
    }

    return map;
  }
}
