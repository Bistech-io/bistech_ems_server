import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { AUTH_CONSTANTS } from './auth.constants.js';

export interface AuthenticatedUser {
  userId: string;
  organizationId: string;
  sessionId: string;
  roles: string[];
  permissions?: Record<string, string>;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    let token = request.cookies?.[AUTH_CONSTANTS.COOKIE_ACCESS_NAME];
    if (!token) {
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      });
    }

    const payload = await this.authService.verifyAccessToken(token);
    const liveContext = await this.authService.resolveAccessContext(
      payload.sub,
      payload.orgId,
    );

    request.user = {
      userId: payload.sub,
      organizationId: payload.orgId,
      sessionId: payload.sessionId,
      roles: liveContext ? liveContext.roles : payload.roles,
      permissions: liveContext ? liveContext.permissions : undefined,
    };

    return true;
  }
}
