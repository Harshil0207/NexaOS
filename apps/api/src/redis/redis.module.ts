import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig, CONFIG } from '../config/config';

export const REDIS = Symbol('REDIS');
/** Dedicated connection for SUBSCRIBE (a subscribed connection cannot issue other commands). */
export const REDIS_SUB = Symbol('REDIS_SUB');

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
}

@Injectable()
class RedisCloser implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(REDIS_SUB) private readonly sub: Redis,
  ) {}
  async onApplicationShutdown() {
    await Promise.allSettled([this.redis.quit(), this.sub.quit()]);
  }
}

@Global()
@Module({
  providers: [
    { provide: REDIS, inject: [CONFIG], useFactory: (c: AppConfig) => createRedis(c.REDIS_URL) },
    {
      provide: REDIS_SUB,
      inject: [CONFIG],
      useFactory: (c: AppConfig) => createRedis(c.REDIS_URL),
    },
    RedisCloser,
  ],
  exports: [REDIS, REDIS_SUB],
})
export class RedisModule {}
