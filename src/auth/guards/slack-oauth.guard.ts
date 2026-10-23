import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SLACK_OAUTH } from '../auth.constants';

@Injectable()
export class SlackOAuthGuard extends AuthGuard(SLACK_OAUTH) {
  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    if (err || !user) {
      const res = context.switchToHttp().getResponse();
      const frontendUrl =
        process.env.FRONTEND_URL ||
        process.env.APP_WEB_URL ||
        'http://localhost:5173';
      const errorMessage =
        err?.message || info?.message || 'Slack authorization failed';
      return res.redirect(
        `${frontendUrl}/login?error=slack_auth_failed&message=${encodeURIComponent(
          errorMessage,
        )}`,
      );
    }
    return user;
  }
}
