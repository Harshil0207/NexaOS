import { Global, Module } from '@nestjs/common';
import { LlmController } from './llm.controller';
import { LlmRegistry } from './llm.registry';

@Global()
@Module({ controllers: [LlmController], providers: [LlmRegistry], exports: [LlmRegistry] })
export class LlmModule {}
