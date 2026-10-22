import { URL } from 'node:url';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { jwtConfigFactory } from '@Config';
import { AuthenticatedUser, JwtPayload, UserType } from '../types';
import { UtilsService } from '../providers';
import { JWT_AUTH } from '../common.constants';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, JWT_AUTH) {
  private static readonly utilsService = new UtilsService(new ConfigService());

  constructor(
    @Inject(jwtConfigFactory.KEY)
    config: ConfigType<typeof jwtConfigFactory>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        JwtStrategy.fromCookie,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.secret as string,
    });
  }

  private static getAuthCookie(ut: UserType) {
    return JwtStrategy.utilsService.getCookiePrefix(ut) + 'authToken';
  }

  private static fromCookie(req: Request): string | null {
    if (!req.cookies) {
      return null;
    }

    if (req.headers.referer) {
      try {
        const requestedDomain = new URL(req.headers.referer).host;
        if (
          process.env.ADMIN_WEB_URL &&
          requestedDomain === new URL(process.env.ADMIN_WEB_URL).host
        ) {
          const cookie = req.cookies[JwtStrategy.getAuthCookie(UserType.Admin)];
          if (cookie) return cookie;
        }

        if (
          process.env.APP_WEB_URL &&
          requestedDomain === new URL(process.env.APP_WEB_URL).host
        ) {
          const cookie = req.cookies[JwtStrategy.getAuthCookie(UserType.User)];
          if (cookie) return cookie;
        }

        if (
          process.env.FRONTEND_URL &&
          requestedDomain === new URL(process.env.FRONTEND_URL).host
        ) {
          return (
            req.cookies[JwtStrategy.getAuthCookie(UserType.Admin)] ||
            req.cookies[JwtStrategy.getAuthCookie(UserType.User)] ||
            null
          );
        }
      } catch {
        // Fall through to direct cookie check if referer URL parsing fails
      }
    }

    return (
      req.cookies[JwtStrategy.getAuthCookie(UserType.Admin)] ||
      req.cookies[JwtStrategy.getAuthCookie(UserType.User)] ||
      null
    );
  }

  async validate(
    payload: JwtPayload & { readonly iat: number; readonly exp: number },
  ): Promise<AuthenticatedUser> {
    return {
      id: payload.sub,
      type: payload.type,
    };
  }
}
