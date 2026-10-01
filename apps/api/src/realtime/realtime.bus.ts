import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS, REDIS_SUB } from '../redis/redis.module';

export type RealtimeMessage =
  | {
      kind: 'event';
      executionId: string;
      agentId: string;
      seq: number;
      type: string;
      payload: unknown;
      status: string;
      createdAt: string;
    }
  | { kind: 'delta'; executionId: string; step: number; text: string };

type Handler = (msg: RealtimeMessage) => void;

export const orgChannel = (orgId: string) => `nexa:org:${orgId}`;
export const CANCEL_CHANNEL = 'nexa:exec-cancel';

/**
 * Cross-process fan-out over Redis pub/sub. One subscriber connection per process,
 * multiplexed to in-process listeners.
 */
@Injectable()
export class RealtimeBus implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeBus.name);
  private readonly listeners = new Map<string, Set<(raw: string) => void>>();

  constructor(
    @Inject(REDIS) private readonly pub: Redis,
    @Inject(REDIS_SUB) private readonly sub: Redis,
  ) {
    this.sub.on('message', (channel: string, raw: string) => {
      for (const l of this.listeners.get(channel) ?? []) {
        try {
          l(raw);
        } catch (err) {
          this.logger.warn({ err }, 'Realtime listener failed');
        }
      }
    });
  }

  async publish(channel: string, message: unknown): Promise<void> {
    await this.pub.publish(channel, JSON.stringify(message));
  }

  publishOrg(orgId: string, message: RealtimeMessage): Promise<void> {
    return this.publish(orgChannel(orgId), message);
  }

  /** Subscribe to a channel; returns an unsubscribe function. */
  async listen(channel: string, fn: (raw: string) => void): Promise<() => void> {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      await this.sub.subscribe(channel);
    }
    set.add(fn);
    return () => {
      const s = this.listeners.get(channel);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) {
        this.listeners.delete(channel);
        this.sub.unsubscribe(channel).catch(() => undefined);
      }
    };
  }

  async onOrg(orgId: string, handler: Handler): Promise<() => void> {
    return this.listen(orgChannel(orgId), (raw) => handler(JSON.parse(raw) as RealtimeMessage));
  }

  onModuleDestroy() {
    this.listeners.clear();
  }
}
