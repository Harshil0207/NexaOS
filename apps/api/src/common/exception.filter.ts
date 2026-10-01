import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ApiErrorBody, ApiErrorCode } from '@nexa/shared';
import type { Response } from 'express';
import { AppError } from './errors';
import type { NexaRequest } from './request-context';

const STATUS_CODES: Record<number, ApiErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
};

/** Converts every error into a structured body. Never leaks stack traces or internals. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<NexaRequest>();
    const requestId = req?.id;

    let status = 500;
    let body: ApiErrorBody['error'];

    if (exception instanceof AppError) {
      status = exception.status;
      body = {
        code: exception.code,
        message: exception.message,
        requestId,
        details: exception.details,
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const code = STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED');
      // Framework errors (404 route, 413 body) have safe messages; 5xx get a generic one.
      const message = status >= 500 ? 'Internal server error' : exception.message;
      body = { code, message, requestId };
    } else if (isBodyParserError(exception)) {
      status = exception.status;
      body = {
        code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED',
        message: status === 413 ? 'Request body too large' : 'Malformed request body',
        requestId,
      };
    } else {
      body = { code: 'INTERNAL', message: 'Internal server error', requestId };
    }

    if (status >= 500) {
      this.logger.error({ err: exception, requestId }, 'Unhandled error');
    }
    if (res.headersSent) return;
    res.status(status).json({ error: body } satisfies ApiErrorBody);
  }
}

function isBodyParserError(e: unknown): e is { status: number; type: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'type' in e &&
    'status' in e &&
    typeof (e as { status: unknown }).status === 'number'
  );
}
