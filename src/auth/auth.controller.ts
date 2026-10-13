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
  Get,
  Redirect,
} from '@nestjs/common';
import { CookieOptions, Request, Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExcludeEndpoint,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigType } from '@nestjs/config';
import {
  AuthenticatedRequest,
  BaseController,
  JwtAuthGuard,
  UserType,
  UtilsService,
  ValidatedUser,
} from '@Common';
import { appConfigFactory, authConfigFactory } from '@Config';
import {
  AuthService,
  InvalidVerifyCodeResponse,
  ValidAuthResponse,
} from './auth.service';
import { GoogleOAuthGuard, LocalAuthGuard } from './guards';
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
    private readonly authService: AuthService,
    private readonly utilsService: UtilsService,
  ) {
    super();
  }

  private getCookieOptions(options?: CookieOptions) {
    const isProduction = this.utilsService.isProduction();
    return {
      expires: options?.expires,
      domain:
        options?.domain !== undefined ? options.domain : this.appConfig.domain,
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

  private setAuthCookie(
    res: Response,
    accessToken: string,
    userType: UserType,
    expiresIn: number,
  ): void {
    const expirationTime = new Date(Date.now() + expiresIn * 1000);

    this.setCookie(res, this.getAuthCookie(userType), accessToken, {
      expires: expirationTime,
    });
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
    this.setAuthCookie(res, accessToken, type, expiresIn);
    return { accessToken, expiresIn, type };
  }

  @ApiBody({ type: () => LoginRequestDto })
  @UseGuards(LocalAuthGuard)
  @HttpCode(200)
  @Post('login')
  async login(
    @Req() req: Request & { user: ValidatedUser },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, expiresIn, type } = await this.authService.login(
      req.user.id,
      req.user.type,
    );
    this.setAuthCookie(res, accessToken, type, expiresIn);
    return { accessToken, expiresIn, type };
  }

  @UseGuards(GoogleOAuthGuard)
  @Get('google')
  googleOAuth() {}

  @ApiExcludeEndpoint()
  @UseGuards(GoogleOAuthGuard)
  @Get('google/callback')
  @Redirect()
  async googleWebOAuthCallback(
    @Req() req: Request & { user: ValidatedUser },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, expiresIn, type } = await this.authService.login(
      req.user.id,
      req.user.type,
    );
    this.setAuthCookie(res, accessToken, type, expiresIn);
    return {
      url: this.appConfig.appWebUrl as string,
    };
  }

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
    if (!data.email && !data.mobile) throw BadRequestException;
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
