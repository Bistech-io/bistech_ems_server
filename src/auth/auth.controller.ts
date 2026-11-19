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
import { AuthGuard } from './auth.guard.js';
import { AUTH_CONSTANTS } from './auth.constants.js';
import { loginSchema, LoginDto } from './dto/login.dto.js';

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
}
