import {
  Req,
  Res,
  Controller,
  Post,
  UseGuards,
  HttpCode,
  Inject,
  Body,
  BadRequestException,
  UnprocessableEntityException,
  UnauthorizedException,
  ForbiddenException,
  ServiceUnavailableException,
  Get,
  Redirect,
  Query,
} from '@nestjs/common';
import { CookieOptions, Request, Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigType } from '@nestjs/config';
import {
  AccessGuard,
  AuthenticatedRequest,
  BaseController,
  JwtAuthGuard,
  LoggerService,
  UserType,
  UtilsService,
  ValidatedUser,
} from '@Common';
import {
  appConfigFactory,
  authConfigFactory,
  slackConfigFactory,
} from '@Config';
import {
  AuthService,
  InvalidVerifyCodeResponse,
  ValidAuthResponse,
} from './auth.service';
// import { SlackOAuthService } from '/slack-oauth.service';
import { GoogleOAuthGuard, LocalAuthGuard, SlackOAuthGuard } from './guards';
import { AdminService } from '../admin';
import { UsersService } from '../users';
import {
  ForgotPasswordRequestDto,
  RegisterUserRequestDto,
  ResetPasswordRequestDto,
  SendCodeRequestDto,
  LoginRequestDto,
} from './dto';
import { SendCodeResponse } from '../otp';
import { OtpTransport } from '../generated/prisma/client';

@ApiTags('Auth')
@Controller('auth')
export class AuthController extends BaseController {
  constructor(
    @Inject(appConfigFactory.KEY)
    private readonly appConfig: ConfigType<typeof appConfigFactory>,
    @Inject(authConfigFactory.KEY)
    private readonly config: ConfigType<typeof authConfigFactory>,
    @Inject(slackConfigFactory.KEY)
    private readonly slackConfig: ConfigType<typeof slackConfigFactory>,
    private readonly authService: AuthService,
    // private readonly slackOAuthService: SlackOAuthService,
    private readonly adminService: AdminService,
    private readonly usersService: UsersService,
    private readonly utilsService: UtilsService,
  ) {
    super();
  }

  private getSafeCookieDomain(explicitDomain?: string): string | undefined {
    const domain =
      explicitDomain !== undefined ? explicitDomain : this.appConfig?.domain;
    if (!domain || domain === 'localhost' || domain === '127.0.0.1') {
      return undefined;
    }
    return domain;
  }

  private getCookieOptions(options?: CookieOptions) {
    const isProduction = this.utilsService.isProduction();
    return {
      expires: options?.expires,
      domain: this.getSafeCookieDomain(options?.domain),
      httpOnly: options?.httpOnly !== undefined ? options.httpOnly : true,
      sameSite:
        options?.sameSite !== undefined
          ? options.sameSite
          : isProduction
            ? 'strict'
            : 'none',
      secure: options?.secure !== undefined ? options.secure : true,
    };
  }

  private setCookie(
    res: Response,
    key: string,
    value: string,
    options?: CookieOptions,
  ): void {
    res.cookie(key, value, this.getCookieOptions(options));
  }

  private removeCookie(
    res: Response,
    key: string,
    options?: CookieOptions,
  ): void {
    res.clearCookie(key, this.getCookieOptions(options));
  }

  private getAuthCookie(ut: UserType) {
    return this.utilsService.getCookiePrefix(ut) + 'authToken';
  }

  private setAuthCookies(res: Response, accessToken: string): void {
    res.cookie(
      'authToken',
      accessToken,
      this.getCookieOptions({
        expires: this.config.authCookieExpirationTime(),
      }),
    );
  }

  @Post('send-code')
  async sendCode(@Body() data: SendCodeRequestDto) {
    if (data.mobile && !data.country) {
      throw new BadRequestException();
    }

    const response = {} as Record<'email' | 'mobile', SendCodeResponse>;
    if (data.email) {
      response.email = await this.authService.sendCode(
        data.email,
        OtpTransport.Email,
        data.type,
      );
    }
    if (data.mobile) {
      response.mobile = await this.authService.sendCode(
        data.mobile,
        OtpTransport.Mobile,
        data.type,
      );
    }

    return response;
  }

  @Post('register')
  async register(
    @Res({ passthrough: true }) res: Response,
    @Body() data: RegisterUserRequestDto,
  ) {
    const response = await this.authService.registerUser({
      firstname: data.firstname,
      lastname: data.lastname,
      email: data.email,
      password: data.password,
      dialCode: data.dialCode,
      mobile: data.mobile,
      country: data.country,
      emailVerificationCode: data.emailVerificationCode,
      mobileVerificationCode: data.mobileVerificationCode,
    });

    if (
      (response as InvalidVerifyCodeResponse).email ||
      (response as InvalidVerifyCodeResponse).mobile
    ) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: 'Invalid verification code',
        meta: response as InvalidVerifyCodeResponse,
      });
    }

    const { accessToken, expiresIn, type } = response as ValidAuthResponse;
    this.setAuthCookies(res, accessToken);
    return { accessToken, expiresIn, type };
  }

  // @ApiBody({ type: () => LoginRequestDto })
  // @UseGuards(LocalAuthGuard)
  // @HttpCode(200)
  // @Post('login')
  // async login(
  //   @Req() req: Request & { user: ValidatedUser },
  //   @Res({ passthrough: true }) res: Response,
  // ) {
  //   const { accessToken, expiresIn, type } = await this.authService.login(
  //     req.user.id,
  //     req.user.type,
  //   );
  //   this.setAuthCookie(res, accessToken, type, expiresIn);
  //   return { accessToken, expiresIn, type };
  // }

  // @ApiOperation({
  //   summary: 'Initiate Google OAuth 2.0 login flow',
  //   description:
  //     'Initiates Google OAuth 2.0 authorization by redirecting the browser to Google accounts login. **Note:** This endpoint issues an HTTP 302 browser redirect. Do not execute via Swagger UI AJAX "Execute" button (browser fetch will be blocked by Google CORS policy). Test via browser navigation or link: [Open /auth/google](/auth/google)',
  // })
  // @UseGuards(GoogleOAuthGuard)
  // @Get('google')
  // googleOAuth() {}

  // @ApiExcludeEndpoint()
  // @UseGuards(GoogleOAuthGuard)
  // @Get('google/callback')
  // @Redirect()
  // async googleWebOAuthCallback(
  //   @Req() req: Request & { user: ValidatedUser },
  //   @Res({ passthrough: true }) res: Response,
  // ) {
  //   const { accessToken, expiresIn, type } = await this.authService.login(
  //     req.user.id,
  //     req.user.type,
  //   );
  //   this.setAuthCookie(res, accessToken, type, expiresIn);
  //   return {
  //     url: this.appConfig.appWebUrl as string,
  //   };
  // }

  @ApiOperation({
    summary: 'Initiate Slack OAuth login flow',
    description:
      'Initiates Slack OAuth authorization by generating a CSRF state cookie and redirecting the browser to Slack. **Note:** This endpoint issues an HTTP 302 browser redirect. Do not execute via Swagger UI AJAX "Execute" button (browser fetch will be blocked by Slack CORS policy). Test via browser navigation or link: [Open /auth/slack](/auth/slack)',
  })
  @UseGuards(SlackOAuthGuard)
  @Get('slack')
  slackLogin() {}

  /** Slack redirects back here after the user approves access. */
  @ApiExcludeEndpoint()
  @UseGuards(SlackOAuthGuard)
  @Get('slack/callback')
  @Redirect()
  async slackCallback(
    @Req() req: Request & { user: ValidatedUser },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken } = await this.authService.login(req.user);

    this.setAuthCookies(res, accessToken);

    return { url: this.appConfig.appWebUrl as string };
  }

  @ApiOperation({ summary: 'Verify and retrieve current session profile' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @Get('session')
  async getSession(@Req() req: AuthenticatedRequest) {
    const ctx = this.getContext(req);
    let profile: any = null;
    if (ctx.user.type === UserType.Admin) {
      profile = await this.adminService.getProfile(ctx.user.id);
    } else {
      profile = await this.usersService.getProfile(ctx.user.id);
    }
    return {
      authenticated: true,
      user: {
        id: ctx.user.id,
        type: ctx.user.type,
        email: profile?.email,
        firstname: profile?.firstname,
        lastname: profile?.lastname,
        profileImage: profile?.profileImage,
        status: profile?.status,
      },
    };
  }

  @ApiOperation({
    summary: 'Alias to verify and retrieve current session profile',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AccessGuard)
  @Get('me')
  async getMe(@Req() req: AuthenticatedRequest) {
    return this.getSession(req);
  }

  @ApiOperation({ summary: 'Log out current user and clear session cookie' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.getContext(req);
    this.removeCookie(res, this.getAuthCookie(ctx.user.type));
    return { status: 'success' };
  }

  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() data: ForgotPasswordRequestDto) {
    if (!data.email && !data.mobile) {
      throw new BadRequestException('Email or mobile number is required');
    }
    return await this.authService.forgotPassword(data.email, data.mobile);
  }

  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() data: ResetPasswordRequestDto) {
    if (!data.email && !data.mobile) throw new BadRequestException();
    await this.authService.resetPassword(
      data.code,
      data.newPassword,
      data.mobile,
      data.email,
    );
    return { status: 'success' };
  }
}
