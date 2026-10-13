import 'dotenv/config';
import 'winston-mongodb';
import { Logger, createLogger, transports, format, transport } from 'winston';
import { Environment } from '../types';

const { Console, MongoDB } = transports;
const LogLevel = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type LogLevel = keyof typeof LogLevel;

export class LoggerService {
  private readonly logger: Logger;
  private readonly isProduction: boolean;
  private readonly dbUri?: string;

  constructor(defaultMeta?: any) {
    this.isProduction = process.env.NODE_ENV === Environment.Production;
    this.dbUri = process.env.MONGO_URI;

    this.logger = createLogger({
      levels: LogLevel,
      level: process.env.LOG_LEVEL,
      defaultMeta,
      format: this.getFormat(),
      transports: this.getTransports(),
    });
  }

  private getTransports() {
    const transports: transport[] = [
      new Console({
        level: process.env.LOG_LEVEL,
        format: format.colorize({ all: true }),
      }),
    ];

    if (this.isProduction && this.dbUri) {
      transports.push(
        new MongoDB({
          level: process.env.LOG_LEVEL,
          db: this.dbUri,
          collection: 'logs',
          metaKey: 'metadata',
        }),
      );
    }

    return transports;
  }

  private getFormat() {
    return format.combine(
      format.timestamp(),
      format.splat(),
      format.errors({ stack: true, cause: true }),
      format.json(),
    );
  }

  setDefaultMeta(meta?: any) {
    this.logger.defaultMeta = meta;
  }

  child(meta?: any) {
    return new LoggerService({
      ...(this.logger.defaultMeta || {}),
      ...(meta || {}),
    });
  }

  log(level: LogLevel, message: any, ...args: any[]) {
    this.logger.log(level, message, ...args);
  }

  info(message: any, ...args: any[]) {
    this.log('info', message, ...args);
  }

  error(message: any, ...args: any[]) {
    this.log('error', message, ...args);
  }

  warn(message: any, ...args: any[]) {
    this.log('warn', message, ...args);
  }

  debug(message: any, ...args: any[]) {
    this.log('debug', message, ...args);
  }
}
