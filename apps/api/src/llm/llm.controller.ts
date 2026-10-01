import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators';
import { LlmRegistry } from './llm.registry';

@ApiTags('llm')
@Controller('llm')
export class LlmController {
  constructor(private readonly registry: LlmRegistry) {}

  @Get('models')
  @RequirePermission('agents:read')
  models() {
    return this.registry.catalog();
  }
}
