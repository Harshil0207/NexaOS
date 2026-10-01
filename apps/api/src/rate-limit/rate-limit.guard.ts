import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { RATE_LIMIT, RateLimitSpec } from '../common/decorators';
import { Errors } from '../common/errors';
import type { NexaRequest } from '../common/request-context';
import { RateLimitService } from './rate-limit.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const spec = this.reflector.getAllAndOverride<RateLimitSpec | undefined>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!spec) return true;
    const req = context.switchToHttp().getRequest<NexaRequest>();
    const subject =
      spec.by === 'user' && req.auth ? `u:${req.auth.userId}` : `ip:${req.ip ?? 'unknown'}`;
    const r = await this.limiter.consume(
      `${spec.bucket}:${subject}`,
      spec.limit,
      spec.windowSeconds,
    );
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader('RateLimit-Limit', String(spec.limit));
    res.setHeader('RateLimit-Remaining', String(r.remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(r.resetMs / 1000)));
    if (!r.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(r.resetMs / 1000)));
      throw Errors.rateLimited();
    }
    return true;
  }
}
