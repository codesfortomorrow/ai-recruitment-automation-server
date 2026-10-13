import { hrtime } from 'node:process';
import { Request, Response, NextFunction } from 'express';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    (req as any).__metrics = {
      startTime: hrtime.bigint(),
    };

    res.on('finish', () => {
      this.collect(
        req.method,
        this.metrics.getRequestRoute(req),
        res.statusCode,
        this.metrics.getDuration((req as any).__metrics.startTime),
      );
    });

    res.on('close', () => {
      if (!res.writableFinished) {
        this.collect(
          req.method,
          this.metrics.getRequestRoute(req),
          'ABORTED',
          this.metrics.getDuration((req as any).__metrics.startTime),
        );
      }
    });

    next();
  }

  private collect(
    method: string,
    route: string,
    status: string | number,
    duration: number,
  ) {
    const labels = {
      method,
      route,
      status,
    };

    this.metrics.http.incTotal(labels);
    this.metrics.http.observeDuration(labels, duration);
  }
}
