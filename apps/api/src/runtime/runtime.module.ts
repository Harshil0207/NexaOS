import { Global, Module } from '@nestjs/common';
import { CancellationRegistry } from './cancellation.registry';
import { ExecutionEventsService } from './execution-events.service';
import { ExecutionQueue } from './execution.queue';

/** Shared by API and worker: event log, queue producer, cancellation broadcast. */
@Global()
@Module({
  providers: [ExecutionEventsService, ExecutionQueue, CancellationRegistry],
  exports: [ExecutionEventsService, ExecutionQueue, CancellationRegistry],
})
export class RuntimeModule {}
