import { Injectable, OnModuleInit } from '@nestjs/common';
import { CANCEL_CHANNEL, RealtimeBus } from '../realtime/realtime.bus';

export class CancelledError extends Error {
  constructor() {
    super('Execution cancelled');
    this.name = 'CancelledError';
  }
}

export class DeadlineExceededError extends Error {
  constructor() {
    super('Execution deadline exceeded');
    this.name = 'DeadlineExceededError';
  }
}

/** Worker-side: aborts in-flight work (model calls, tools) when a cancel is broadcast. */
@Injectable()
export class CancellationRegistry implements OnModuleInit {
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly bus: RealtimeBus) {}

  async onModuleInit() {
    await this.bus.listen(CANCEL_CHANNEL, (executionId) => this.abort(executionId));
  }

  register(executionId: string, controller: AbortController): () => void {
    this.controllers.set(executionId, controller);
    return () => {
      if (this.controllers.get(executionId) === controller) this.controllers.delete(executionId);
    };
  }

  abort(executionId: string) {
    const c = this.controllers.get(executionId);
    if (c && !c.signal.aborted) c.abort(new CancelledError());
  }

  /** API-side: broadcast a cancellation to whichever worker owns the run. */
  broadcast(executionId: string) {
    return this.bus.publish(CANCEL_CHANNEL, executionId).catch(() => undefined);
  }
}
