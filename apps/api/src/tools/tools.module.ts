import { Global, Module } from '@nestjs/common';
import { ToolRegistry } from './tool.registry';
import { ToolsController } from './tools.controller';
import { ToolsService } from './tools.service';

@Global()
@Module({
  controllers: [ToolsController],
  providers: [ToolRegistry, ToolsService],
  exports: [ToolRegistry, ToolsService],
})
export class ToolsModule {}
