import { Module } from '@nestjs/common';
import { AgentRuntime } from './agent-runtime';
import { ExecutionWorker } from './execution.worker';
import { ToolExecutor } from './tool-executor';

@Module({
  providers: [AgentRuntime, ToolExecutor, ExecutionWorker],
  exports: [AgentRuntime, ToolExecutor],
})
export class WorkerModule {}
