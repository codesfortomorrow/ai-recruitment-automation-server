import { SetMetadata } from '@nestjs/common';

export const DISABLE_CACHE_KEY = 'disable_cache';

export const DisableCache = () => SetMetadata(DISABLE_CACHE_KEY, true);
