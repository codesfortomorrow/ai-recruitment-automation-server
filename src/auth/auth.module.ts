import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigType } from '@nestjs/config';
import { jwtConfigFactory } from '@Config';
import { AuthService } from './auth.service';
// import { SlackOAuthService } from './slack-oauth.service';
import { AuthController } from './auth.controller';
import { GoogleStrategy, LocalStrategy, SlackStrategy } from './strategies';
import { AdminModule } from '../admin';
import { UsersModule } from '../users';
import { OtpModule } from '../otp';
import { PrismaModule } from '../prisma';

@Module({
  imports: [
    AdminModule,
    UsersModule,
    OtpModule,
    PrismaModule,
    JwtModule.registerAsync({
      useFactory: (config: ConfigType<typeof jwtConfigFactory>) => ({
        secret: config.secret,
        signOptions: config.signOptions,
      }),
      inject: [jwtConfigFactory.KEY],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SlackStrategy, LocalStrategy, GoogleStrategy],
  exports: [AuthService, SlackStrategy],
})
export class AuthModule {}
