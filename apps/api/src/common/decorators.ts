import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@nexa/shared';
import { Errors } from './errors';
import type { AuthContext, NexaRequest, OrgContext } from './request-context';

export const IS_PUBLIC = 'nexa:public';
export const PERMISSION = 'nexa:permission';
export const RATE_LIMIT = 'nexa:rate-limit';

/** Route requires no session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route requires an active organisation membership granting this permission. */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION, permission);

export interface RateLimitSpec {
  bucket: string;
  limit: number;
  windowSeconds: number;
  /** Key by client IP (unauthenticated routes) or by user. */
  by: 'ip' | 'user';
}
export const RateLimit = (spec: RateLimitSpec) => SetMetadata(RATE_LIMIT, spec);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<NexaRequest>();
  if (!req.auth) throw Errors.unauthenticated();
  return req.auth;
});

export const Org = createParamDecorator((_: unknown, ctx: ExecutionContext): OrgContext => {
  const req = ctx.switchToHttp().getRequest<NexaRequest>();
  if (!req.org) throw Errors.forbidden('Select an organisation first');
  return req.org;
});
