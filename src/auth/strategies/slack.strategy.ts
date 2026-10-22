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

type SlackDoneCallback = (err: Error | null, user?: unknown) => void;

export class SlackStrategy extends PassportStrategy(Strategy, SLACK_OAUTH) {
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
    profile: SlackProfile,
    done: SlackDoneCallback,
  ): Promise<void> {
    const { team, user } = profile;

    if (!team?.id || team.id !== this.slackConfig.allowedTeamId) {
      done(new UnauthorizedException('This Slack workspace is not authorized'));
      return;
    }

    if (!user?.email) {
      done(new UnprocessableEntityException('Slack profile email not public'));
      return;
    }

    const [firstname, ...rest] = (user.name || '').split(' ');

    const authenticatedUser = await this.usersService.getOrCreateBySlack({
      slackUserId: user.id,
      slackTeamId: team.id,
      email: user.email,
      firstname: firstname || user.name || 'Slack',
      lastname: rest.join(' ') || '',
      avatarUrl: user.image_192,
    });

    done(null, authenticatedUser);
  }
}
