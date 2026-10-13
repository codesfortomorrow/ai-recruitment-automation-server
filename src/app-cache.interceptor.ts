import { CacheInterceptor } from '@nestjs/cache-manager';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { DISABLE_CACHE_KEY } from '@Common';

@Injectable()
export class AppCacheInterceptor extends CacheInterceptor {
  trackBy(context: ExecutionContext) {
    const hostType = context.getType();
    if (hostType === 'http') {
      const request = context.switchToHttp().getRequest();
      const { method, url, user } = request;
      if (method === 'GET' && /\/me(?:\/|$)/.test(url) && user) {
        return url.concat(`(me=${user.id})`);
      }
    }
    return super.trackBy(context);
  }

  protected isRequestCacheable(context: ExecutionContext): boolean {
    const disabled = this.reflector.getAllAndOverride<boolean>(
      DISABLE_CACHE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (disabled) return false;
    return super.isRequestCacheable(context);
  }
}
