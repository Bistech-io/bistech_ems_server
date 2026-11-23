import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { AuthGuard, type AuthenticatedUser } from './auth.guard.js';
import { AUTH_CONSTANTS } from './auth.constants.js';
import { loginSchema, LoginDto } from './dto/login.dto.js';
import {
  forgotPasswordSchema,
  verifyOtpSchema,
  resetPasswordSchema,
} from './dto/reset-password.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parseResult = loginSchema.safeParse(body);
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

    const dto = parseResult.data;
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await this.authService.login(dto, ip, userAgent);

    const isProd = process.env.NODE_ENV === 'production';

    res.cookie(AUTH_CONSTANTS.COOKIE_ACCESS_NAME, result.accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: AUTH_CONSTANTS.COOKIE_ACCESS_MAX_AGE_MS,
    });

    res.cookie(AUTH_CONSTANTS.COOKIE_REFRESH_NAME, result.refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: AUTH_CONSTANTS.COOKIE_REFRESH_MAX_AGE_MS,
    });

    return {
      success: true,
      message: 'Signed in successfully',
      data: result.authMeData,
      meta: null,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawRefreshToken = req.cookies?.[AUTH_CONSTANTS.COOKIE_REFRESH_NAME];
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await this.authService.refresh(rawRefreshToken, ip, userAgent);

    const isProd = process.env.NODE_ENV === 'production';

    res.cookie(AUTH_CONSTANTS.COOKIE_ACCESS_NAME, result.accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: AUTH_CONSTANTS.COOKIE_ACCESS_MAX_AGE_MS,
    });

    res.cookie(AUTH_CONSTANTS.COOKIE_REFRESH_NAME, result.refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: AUTH_CONSTANTS.COOKIE_REFRESH_MAX_AGE_MS,
    });

    return {
      success: true,
      message: 'Session refreshed',
      data: result.authMeData,
      meta: null,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawRefreshToken = req.cookies?.[AUTH_CONSTANTS.COOKIE_REFRESH_NAME];
    await this.authService.logout(rawRefreshToken);

    const isProd = process.env.NODE_ENV === 'production';

    res.clearCookie(AUTH_CONSTANTS.COOKIE_ACCESS_NAME, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
    });

    res.clearCookie(AUTH_CONSTANTS.COOKIE_REFRESH_NAME, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/api/v1/auth',
    });

    return {
      success: true,
      message: 'Signed out',
      data: null,
      meta: null,
    };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async getMe(@Req() req: Request) {
    const user = req.user!;
    const csrfToken = req.headers['x-csrf-token'] as string || 'default-csrf-token';
    const authMeData = await this.authService.getMe(user.userId, user.organizationId, csrfToken);

    return {
      success: true,
      message: 'Session loaded',
      data: authMeData,
      meta: null,
    };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const parseResult = forgotPasswordSchema.safeParse(body);
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

    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    const result = await this.authService.forgotPassword(parseResult.data, ip);

    return {
      success: true,
      message: result.message,
      data: null,
      meta: null,
    };
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parseResult = verifyOtpSchema.safeParse(body);
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

    const result = await this.authService.verifyOtp(parseResult.data);
    const isProd = process.env.NODE_ENV === 'production';

    res.cookie(AUTH_CONSTANTS.COOKIE_RESET_NAME, result.resetToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/api/v1/auth/reset-password',
      maxAge: AUTH_CONSTANTS.COOKIE_RESET_MAX_AGE_MS,
    });

    return {
      success: true,
      message: 'OTP verified successfully',
      data: {
        resetToken: result.resetToken,
      },
      meta: null,
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parseResult = resetPasswordSchema.safeParse(body);
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

    let callerUser: AuthenticatedUser | undefined;
    let token = req.cookies?.[AUTH_CONSTANTS.COOKIE_ACCESS_NAME];
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (token) {
      try {
        const payload = await this.authService.verifyAccessToken(token);
        callerUser = {
          userId: payload.sub,
          organizationId: payload.orgId,
          sessionId: payload.sessionId,
          roles: payload.roles,
        };
      } catch {
        // Fall back to checking reset token
      }
    }

    const rawResetToken = req.cookies?.[AUTH_CONSTANTS.COOKIE_RESET_NAME];
    const result = await this.authService.resetPassword(
      parseResult.data,
      rawResetToken,
      callerUser,
    );

    if (rawResetToken) {
      res.clearCookie(AUTH_CONSTANTS.COOKIE_RESET_NAME, {
        path: '/api/v1/auth/reset-password',
      });
    }

    return {
      success: true,
      message: result.message,
      data: null,
      meta: null,
    };
  }
}
