import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, ROLE_PERMISSIONS } from '@nexa/shared';
import { IS_PUBLIC, PERMISSION } from '../common/decorators';
import { Errors } from '../common/errors';
import type { NexaRequest } from '../common/request-context';
import { SessionService } from './session.service';

/**
 * Global guard: resolves the session cookie into an AuthContext, and the session's active
 * organisation (re-verified against memberships on every request) into an OrgContext.
 * Then enforces @RequirePermission.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const req = context.switchToHttp().getRequest<NexaRequest>();
    const token = (req.cookies as Record<string, string> | undefined)?.[this.sessions.cookieName];

    const session = token ? await this.sessions.resolve(token) : null;
    if (session) {
      req.auth = {
        userId: session.userId,
        sessionId: session.sessionId,
        email: session.email,
        name: session.name,
        requestId: req.id,
        ip: req.ip ?? null,
      };
      if (session.activeOrganizationId && session.role) {
        req.org = {
          ...req.auth,
          orgId: session.activeOrganizationId,
          role: session.role,
          permissions: ROLE_PERMISSIONS[session.role],
        };
      }
    }
    if (isPublic) return true;
    if (!req.auth) throw Errors.unauthenticated();

    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION,
      targets,
    );
    if (permission) {
      if (!req.org) throw Errors.forbidden('Select an organisation first');
      if (!req.org.permissions.has(permission)) throw Errors.forbidden();
    }
    return true;
  }
}
