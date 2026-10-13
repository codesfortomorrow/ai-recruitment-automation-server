import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { UtilsService } from '@Common';
import { MetricsService } from './metrics.service';
import { MetricsMiddleware } from './metrics.middleware';

@Module({
  imports: [],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule implements NestModule {
  constructor(private readonly utilsService: UtilsService) {}

  configure(consumer: MiddlewareConsumer) {
    if (this.utilsService.isMetricsEnabled()) {
      consumer.apply(MetricsMiddleware).forRoutes('*');
    }
  }
}
