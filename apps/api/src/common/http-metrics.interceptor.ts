import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { finalize, Observable } from 'rxjs';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const end = this.metrics.httpDuration.startTimer();
    return next.handle().pipe(
      finalize(() => {
        const route = (req.route as { path?: string } | undefined)?.path ?? 'unknown';
        end({ method: req.method, route, status: String(res.statusCode) });
      }),
    );
  }
}
