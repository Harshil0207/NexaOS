import type { ApiErrorCode } from '@nexa/shared';

/** Domain error carrying a client-safe message and a stable code. */
export class AppError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  validation: (
    details: { path: string; message: string }[],
    message = 'Request validation failed',
  ) => new AppError('VALIDATION_FAILED', 400, message, details),
  unauthenticated: (message = 'Authentication required') =>
    new AppError('UNAUTHENTICATED', 401, message),
  forbidden: (message = 'You do not have permission to perform this action') =>
    new AppError('FORBIDDEN', 403, message),
  notFound: (resource = 'Resource') => new AppError('NOT_FOUND', 404, `${resource} not found`),
  conflict: (message: string) => new AppError('CONFLICT', 409, message),
  rateLimited: (message = 'Too many requests, please slow down') =>
    new AppError('RATE_LIMITED', 429, message),
  dependency: (message: string) => new AppError('DEPENDENCY_FAILED', 503, message),
};
