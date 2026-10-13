import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { finalize } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() === 'http') {
      const http = context.switchToHttp();
      const req = http.getRequest<Request>();

      const method = req.method;
      const route = this.metrics.getRequestRoute(req);

      // Increment in-flight requests
      this.metrics.http.incInFlight({ method, route });

      return next.handle().pipe(
        finalize(() => {
          // Decrement in-flight requests
          this.metrics.http.decInFlight({ method, route });
        }),
      );
    }

    return next.handle();
  }
}
