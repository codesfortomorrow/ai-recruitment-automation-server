import { Redis } from 'ioredis';
import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '@Common';

@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  client: Redis;

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async onModuleInit() {
    this.client = new Redis(this.configService.get('REDIS_URI'), {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });

    this.client.on('error', (err: Error) => {
      this.logger.warn(`Redis client error: ${err.message}`);
    });

    await this.client.connect();
  }

  async onApplicationShutdown() {
    if (this.client) {
      await this.client.quit();
    }
  }
}
