declare module 'passport-slack-oauth2' {
  import { Strategy as PassportStrategy } from 'passport-strategy';

  interface SlackProfile {
    id: string;
    displayName?: string;
    username?: string;
    emails?: Array<{ value: string }>;
    photos?: Array<{ value: string }>;
    [key: string]: unknown;
  }

  interface SlackStrategyOptions {
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    scope?: string | string[];
    passReqToCallback?: boolean;
  }

  type VerifyCallback = (
    err: Error | null,
    user?: unknown,
    info?: unknown,
  ) => void;

  class Strategy extends PassportStrategy {
    constructor(
      options: SlackStrategyOptions,
      verify: (
        accessToken: string,
        profile: SlackProfile,
        done: VerifyCallback,
      ) => void,
    );
  }

  export { Strategy };
}
