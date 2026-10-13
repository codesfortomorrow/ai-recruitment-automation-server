import { Request } from 'express';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

export enum NodeType {
  Master = 'master',
  Cluster = 'cluster',
}

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(NodeType)
  NODE_TYPE: NodeType;

  @IsEnum(Environment)
  NODE_ENV: Environment;

  @IsEnum(Environment)
  APP_ENV: Environment;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  CLUSTER_WORKERS?: number;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  REDIS_URI: string;

  @IsString()
  STORAGE_DIR: string;

  @IsOptional()
  @IsBoolean()
  @Transform((params) => (params.obj.ENABLE_METRICS === 'true' ? true : false))
  ENABLE_METRICS?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  METRICS_PORT?: number;
}

/**
 * ExcludeUndefinedIf<ExcludeUndefined, T>
 *
 * If `ExcludeUndefined` is `true`, remove `undefined` from `T`.
 * Otherwise, constructs the type `T` with `undefined`.
 */
export type ExcludeUndefinedIf<
  ExcludeUndefined extends boolean,
  T,
> = ExcludeUndefined extends true ? Exclude<T, undefined> : T | undefined;

export interface File {
  /** Name of the form field associated with this file. */
  fieldname: string;
  /** Name of the file on the uploader's computer. */
  originalname: string;
  /**
   * Value of the `Content-Transfer-Encoding` header for this file.
   * @deprecated since July 2015
   * @see RFC 7578, Section 4.7
   */
  encoding: string;
  /** Value of the `Content-Type` header for this file. */
  mimetype: string;
  /** Size of the file in bytes. */
  size: number;
  /** `DiskStorage` only: Directory to which this file has been uploaded. */
  destination: string;
  /** `DiskStorage` only: Name of this file within `destination`. */
  filename: string;
  /** `DiskStorage` only: Full path to the uploaded file. */
  path: string;
}

export enum UserType {
  User = 'user',
  Admin = 'admin',
}

export interface JwtPayload {
  readonly sub: number;
  readonly type: UserType;
}

export interface ValidatedUser {
  readonly id: number;
  readonly type: UserType;
}

export interface AuthenticatedUser {
  readonly id: number;
  readonly type: UserType;
}

export interface Context {
  readonly user: AuthenticatedUser;
}

export interface AuthenticatedRequest extends Request {
  readonly user: AuthenticatedUser;
}
