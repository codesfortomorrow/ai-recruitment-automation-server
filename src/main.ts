// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt#use_within_json
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

import cluster from 'node:cluster';
import path from 'node:path';
import helmet from 'helmet';
import compression from 'compression';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService, ConfigType } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import {
  EnvironmentVariables,
  LoggerService,
  NodeType,
  UtilsService,
} from '@Common';
import { appConfigFactory } from '@Config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { MetricsService } from './metrics';

const logger = new LoggerService();

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: process.env.NODE_TYPE === NodeType.Master ? undefined : false,
  });

  const configService = app.get(ConfigService<EnvironmentVariables, true>);
  const utilsService = app.get(UtilsService);
  const appConfig = app.get<ConfigType<typeof appConfigFactory>>(
    appConfigFactory.KEY,
  );

  if (utilsService.isMaster() || cluster.isWorker) {
    app.useBodyParser('json', { limit: appConfig.httpPayloadMaxSize });
    app.useBodyParser('urlencoded', {
      limit: appConfig.httpPayloadMaxSize,
      extended: true,
    });
    app.use(compression({ level: 1 }));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidUnknownValues: true,
        stopAtFirstError: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));

    const origins = appConfig.domain
      ? [
          new RegExp(
            `^http[s]{0,1}://(?:${appConfig.domain}|[a-z0-9-]+.${appConfig.domain})$`,
          ),
        ]
      : [];
    app.enableCors({
      origin: utilsService.isProductionApp()
        ? origins
        : [
            'null',
            new RegExp(`^http[s]{0,1}://(?:127.0.0.1|localhost)(:[0-9]+)*$`),
            ...origins,
          ],
      credentials: true,
    });
    app.use(cookieParser());
    app.use(
      helmet({
        crossOriginResourcePolicy: {
          policy: utilsService.isProductionApp() ? 'same-site' : 'cross-origin',
        },
      }),
    );
    app.enableShutdownHooks();
    app.useStaticAssets(
      path.join(process.cwd(), configService.get('STORAGE_DIR')),
      { prefix: `/${configService.get('STORAGE_DIR')}` },
    );
    app.useStaticAssets(path.join(process.cwd(), 'static'));

    if (!utilsService.isProductionApp()) {
      const docConfig = new DocumentBuilder()
        .setTitle(appConfig.name || '')
        .addServer(appConfig.serverUrl || '')
        .addBearerAuth()
        .build();
      const document = SwaggerModule.createDocument(app, docConfig);
      SwaggerModule.setup('api-spec', app, document, {
        customSiteTitle: `${appConfig.name || ''} OpenAPI Specification`.trim(),
        swaggerOptions: {
          persistAuthorization: true,
        },
      });
    }

    await app.listen(configService.get('PORT'));

    // Send messages to the parent process if server spawned with an IPC channel
    if (process.send) {
      process.send('ready');
    }
  }

  // Enable metrics server
  if (utilsService.isMetricsEnabled()) {
    app.get(MetricsService).init();
  }

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', err);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', { promise, reason });
  });
}

if (process.env.NODE_TYPE === NodeType.Master) {
  bootstrap();
} else if (process.env.NODE_TYPE === NodeType.Cluster) {
  // Will run application in cluster mode & without master processes
  if (cluster.isPrimary) {
    const totalWorkers = Number(process.env.CLUSTER_WORKERS || 2);
    const workerIndexMap = new Map<number, number>();
    for (let i = 0; i < totalWorkers; i++) {
      const worker = cluster.fork({ WORKER_INDEX: i });
      workerIndexMap.set(worker.id, i);

      logger.info(`Spawned worker process ${worker.process.pid}`);
    }

    logger.info(`Cluster mode enabled with ${totalWorkers} workers`);

    cluster.on('exit', (worker, code, signal) => {
      if (signal !== 'SIGINT' && signal !== 'SIGTERM') {
        logger.info(`Worker ${worker.process.pid} died. Respawning...`, {
          code,
          signal,
        });

        const index = workerIndexMap.get(worker.id)!;
        const newWorker = cluster.fork({
          WORKER_INDEX: index,
        });
        workerIndexMap.delete(worker.id);
        workerIndexMap.set(newWorker.id, index);

        logger.info(`Respawned worker process ${newWorker.process.pid}`);
      }
    });

    bootstrap();
  } else {
    bootstrap();
  }
} else {
  throw new Error(
    `Unknown node type '${process.env.NODE_TYPE}' found, possible types are ${NodeType.toString()}`,
  );
}
