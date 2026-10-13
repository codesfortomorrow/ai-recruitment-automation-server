import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables, LoggerService } from '@Common';
import { Prisma, PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient<{
    datasourceUrl: string;
    errorFormat?: Prisma.ErrorFormat;
    log: Prisma.LogDefinition[];
  }>
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new LoggerService({ service: PrismaService.name });

  constructor(
    readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {
    const datasourceUrl = new URL(configService.get('DATABASE_URL'));

    super({
      datasourceUrl: datasourceUrl.toString(),
      errorFormat: 'minimal',
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'info' },
        { emit: 'event', level: 'warn' },
      ],
    });
  }

  async onModuleInit() {
    this.$on('query', (e: Prisma.QueryEvent) => {
      if (e.duration > 1000) {
        this.logger.warn({
          message: `Query took ${e.duration}ms duration`,
          ...e,
        });
      }
    });
    this.$on('info', (e: Prisma.LogEvent) => this.logger.info(e));
    this.$on('warn', (e: Prisma.LogEvent) => this.logger.warn(e));

    await this.$connect();
  }

  async onApplicationShutdown() {
    this.logger.info('Graceful shutdown started');

    // Disconnect
    await this.$disconnect();

    this.logger.info('Graceful shutdown completed');
  }
}
