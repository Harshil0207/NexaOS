import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

// Atomic fixed-window counter: INCR and set expiry on first hit.
const SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {n, redis.call('PTTL', KEYS[1])}
`;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const [count, ttl] = (await this.redis.eval(
      SCRIPT,
      1,
      `rl:${key}`,
      String(windowSeconds * 1000),
    )) as [number, number];
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetMs: Math.max(0, ttl),
    };
  }
}
