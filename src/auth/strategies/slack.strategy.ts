import {
  Inject,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigType } from '@nestjs/config';
// Types for this package are hand-declared in src/types/passport-slack-oauth2.d.ts
import { Strategy } from 'passport-slack-oauth2';
import { appConfigFactory, slackConfigFactory } from '../../configs';
import { SLACK_OAUTH } from '../auth.constants';
import { UsersService } from '../../users';
import { ValidatedUser } from '@Common';

interface SlackProfile {
  id: string;
  displayName: string;
  user: {
    id: string;
    name: string;
    email: string;
    image_192?: string;
  };
  team: {
    id: string;
    name: string;
  };
}

// type SlackDoneCallback = (err: Error | null, user?: unknown) => void;

export class SlackStrategy extends PassportStrategy(
  Strategy as any,
  SLACK_OAUTH,
) {
  constructor(
    @Inject(appConfigFactory.KEY)
    appConfig: ConfigType<typeof appConfigFactory>,
    @Inject(slackConfigFactory.KEY)
    private readonly slackConfig: ConfigType<typeof slackConfigFactory>,
    private readonly usersService: UsersService,
  ) {
    super({
      clientID: slackConfig.oauth.clientId as string,
      clientSecret: slackConfig.oauth.clientSecret as string,
      scope: slackConfig.oauth.scope,
      callbackURL: `${appConfig.serverUrl}/auth/slack/callback`,
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: SlackProfile,
  ): Promise<ValidatedUser> {
    if (!profile?.user) {
      throw new UnauthorizedException(
        'Slack did not return a valid user profile.',
      );
    }

    const { team, user } = profile;

    if (!team?.id || team.id !== this.slackConfig.allowedTeamId) {
      throw new UnauthorizedException('This Slack workspace is not authorized');
    }

    if (!user.email) {
      throw new UnprocessableEntityException('Slack profile email not public');
    }

    const [firstname, ...rest] = (user.name || '').split(' ');

    return this.usersService.getOrCreateBySlack({
      slackUserId: user.id,
      slackTeamId: team.id,
      email: user.email,
      firstname: firstname || user.name || 'Slack',
      lastname: rest.join(' ') || '',
      avatarUrl: user.image_192,
    });
  }
}
