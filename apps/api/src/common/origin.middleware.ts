import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppConfig, CONFIG } from '../config/config';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated requests (in addition to SameSite=Lax):
 * state-changing requests must come from an allowed Origin (or Referer).
 */
@Injectable()
export class OriginCheckMiddleware implements NestMiddleware {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  use(req: Request, res: Response, next: NextFunction) {
    if (SAFE.has(req.method)) return next();
    const hasCookie = typeof req.headers.cookie === 'string' && req.headers.cookie.length > 0;
    const origin = req.headers.origin ?? refererOrigin(req.headers.referer);
    if (!origin) {
      // Non-browser clients without cookies (no ambient credentials) are not CSRF-able.
      if (!hasCookie) return next();
      return reject(res);
    }
    if (this.config.WEB_ORIGIN.includes(origin)) return next();
    return reject(res);
  }
}

function refererOrigin(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  try {
    return new URL(ref).origin;
  } catch {
    return undefined;
  }
}

function reject(res: Response) {
  res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cross-origin request blocked' } });
}
