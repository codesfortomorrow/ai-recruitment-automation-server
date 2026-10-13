import cluster from 'node:cluster';
import { Server } from 'node:http';
import { hrtime } from 'node:process';
import express, { Request } from 'express';
import client from 'prom-client';
import { ConfigService } from '@nestjs/config';
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import {
  BaseService,
  EnvironmentVariables,
  StorageService,
  UtilsService,
} from '@Common';

type MetricsRegistry =
  | client.Registry<client.PrometheusContentType>
  | client.AggregatorRegistry<client.PrometheusContentType>;

@Injectable()
export class MetricsService
  extends BaseService
  implements OnApplicationShutdown
{
  readonly isEnabled: boolean;

  private server: Server;
  private registry: MetricsRegistry;
  private defaultLabels: Record<string, string> = {};

  // HTTP metrics
  private httpRequestsTotal: client.Counter;
  private httpRequestDuration: client.Histogram;
  private httpRequestsInFlight: client.Gauge;

  // Storage metrics
  private storageUsedBytes: client.Gauge;
  private storageFilesTotal: client.Gauge;
  private storageDirsTotal: client.Gauge;
  private storageEphemeralFilesTotal: client.Gauge;
  private storageEphemeralUsedBytes: client.Gauge;

  // TODO: Add metrics for http req & res size
  // TODO: Add metrics for http cache hit count

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly utilsService: UtilsService,
    private readonly storageService: StorageService,
  ) {
    super({ loggerDefaultMeta: { service: MetricsService.name } });

    this.isEnabled = this.utilsService.isMetricsEnabled();
  }

  async onApplicationShutdown() {
    this.logger.info('Graceful shutdown started');

    await this.shutdown().catch((err) => {
      this.logger.error('Error occurred while closing metrics server', {
        cause: err,
      });
    });

    this.logger.info('Graceful shutdown completed');
  }

  private async shutdown() {
    if (!this.server) return;

    await new Promise<void>((resolve, reject) => {
      this.server.close((err?: Error) => {
        if (err) {
          reject(err);
        } else {
          this.logger.info('Server closed');
          resolve();
        }
      });
    });
  }

  private bootstrap() {
    const app = express();
    const path = '/metrics';

    app.get(path, async (req, res) => {
      try {
        if (!this.registry) {
          res.status(500).send('Metrics service not initialized');
          return;
        }

        res.setHeader('Content-Type', this.registry.contentType);
        res.send(await this.getAll());
      } catch (err) {
        this.logger.error('Error occurred while collecting metrics', {
          cause:
            err instanceof Error
              ? {
                  message: err.message,
                  name: err.name,
                  stack: err.stack,
                  cause: err.cause,
                }
              : err,
        });

        res.status(500).send('Unexpected error occurred');
      }
    });

    const host = '0.0.0.0';
    const port = this.configService.get('METRICS_PORT') || 8080;

    this.server = app.listen(port, host, () => {
      this.logger.info(`Metrics server running on http://${host}:${port}`, {
        path,
      });
    });
  }

  async init() {
    if (this.registry) return;

    if (this.utilsService.isMaster()) {
      this.registry = new client.Registry();

      client.collectDefaultMetrics({ register: this.registry });
    } else {
      this.registry = new client.AggregatorRegistry();

      // Collect metrics from worker process
      if (cluster.isWorker) {
        this.defaultLabels = {
          worker:
            process.env.WORKER_INDEX?.toString() ||
            cluster.worker!.id.toString(),
        };
        this.registry.setDefaultLabels(this.defaultLabels);

        client.AggregatorRegistry.setRegistries(this.registry);
        client.collectDefaultMetrics({
          register: this.registry,
        });
      }
    }

    // Initialize app metrics
    if (this.utilsService.isMaster() || cluster.isWorker) {
      this.initHttp(this.registry);

      // Only primary
      if (cluster.isPrimary) {
        this.initStorage(this.registry);
      }
    }

    // Run metrics server
    if (cluster.isPrimary) {
      this.bootstrap();
    }
  }

  private initHttp(registry: MetricsRegistry) {
    this.httpRequestsTotal = new client.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests.',
      labelNames: ['method', 'route', 'status'],
      registers: [registry],
    });

    this.httpRequestDuration = new client.Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds.',
      labelNames: ['method', 'route', 'status'],
      buckets: [
        0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 20, 30, 45,
        60,
      ],
      registers: [registry],
    });

    this.httpRequestsInFlight = new client.Gauge({
      name: 'http_requests_in_flight',
      help: 'Number of HTTP requests currently being processed.',
      labelNames: ['method', 'route'],
      registers: [registry],
    });
  }

  private initStorage(registry: MetricsRegistry) {
    this.storageUsedBytes = new client.Gauge({
      name: 'storage_used_bytes',
      help: 'Total size of the storage directory in bytes.',
      registers: [registry],
    });

    this.storageFilesTotal = new client.Gauge({
      name: 'storage_files_total',
      help: 'Total number of files in the storage directory.',
      registers: [registry],
    });

    this.storageDirsTotal = new client.Gauge({
      name: 'storage_dirs_total',
      help: 'Total number of directories in the storage directory.',
      registers: [registry],
    });

    this.storageEphemeralFilesTotal = new client.Gauge({
      name: 'storage_ephemeral_files_total',
      help: 'Total number of ephemeral files not associated with any folder.',
      registers: [registry],
    });

    this.storageEphemeralUsedBytes = new client.Gauge({
      name: 'storage_ephemeral_used_bytes',
      help: 'Total size of ephemeral files in bytes.',
      registers: [registry],
    });

    // Pool storage metrics
    const collect = async () => {
      try {
        const { size, files, dirs, ephemeralSize, ephemeralFiles } =
          await this.storageService.collectMetrics();

        this.storageUsedBytes.set(size);
        this.storageFilesTotal.set(files);
        this.storageDirsTotal.set(dirs);
        this.storageEphemeralUsedBytes.set(ephemeralSize);
        this.storageEphemeralFilesTotal.set(ephemeralFiles);
      } catch (err) {
        this.logger.error('Error occurred while collecting storage metrics', {
          cause:
            err instanceof Error
              ? {
                  message: err.message,
                  name: err.name,
                  stack: err.stack,
                  cause: err.cause,
                }
              : err,
        });
      } finally {
        setTimeout(() => collect(), 5000);
      }
    };

    collect();
  }

  private async get(): Promise<string> {
    if (this.utilsService.isMaster()) {
      return await this.registry.metrics();
    } else {
      return await (
        this.registry as client.AggregatorRegistry<client.PrometheusContentType>
      ).clusterMetrics();
    }
  }

  private async getAll(): Promise<string> {
    const metrics = await Promise.all([this.get()]);

    // Join all the metrics
    return metrics.join('\n');
  }

  private callMetric<T extends client.Metric>(metric: T, fn: (m: T) => void) {
    if (!this.isEnabled) return;

    try {
      fn(metric);
    } catch (err) {
      this.logger.error('Metric operation failed', {
        cause:
          err instanceof Error
            ? {
                message: err.message,
                name: err.name,
                stack: err.stack,
                cause: err.cause,
              }
            : err,
      });
    }
  }

  getRequestRoute(req: Request): string {
    return req.route?.path || req.path;
  }

  getDuration(startTime: bigint): number {
    return Number(hrtime.bigint() - startTime) / 1e9;
  }

  readonly http = {
    incTotal: (labels: {
      method: string;
      route: string;
      status: string | number;
    }) => {
      this.callMetric(this.httpRequestsTotal, (m) => m.inc(labels));
    },

    observeDuration: (
      labels: { method: string; route: string; status: string | number },
      value: number,
    ) => {
      this.callMetric(this.httpRequestDuration, (m) =>
        m.observe(labels, value),
      );
    },

    incInFlight: (labels: { method: string; route: string }) => {
      this.callMetric(this.httpRequestsInFlight, (m) => m.inc(labels));
    },

    decInFlight: (labels: { method: string; route: string }) => {
      this.callMetric(this.httpRequestsInFlight, (m) => m.dec(labels));
    },
  };
}
