import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SLACK_OAUTH } from '../auth.constants';

@Injectable()
export class SlackOAuthGuard extends AuthGuard(SLACK_OAUTH) {}
