import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module';
import { loggerParams } from './common/logger';
import { AppConfig, CONFIG } from './config/config';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { LlmModule } from './llm/llm.module';
import { MailModule } from './mail/mail.module';
import { MetricsModule } from './metrics/metrics.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RedisModule } from './redis/redis.module';
import { RuntimeModule } from './runtime/runtime.module';
import { ToolsModule } from './tools/tools.module';

/** Infrastructure shared by the API and the worker process. */
@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [CONFIG], useFactory: (c: AppConfig) => loggerParams(c) }),
    DbModule,
    RedisModule,
    MetricsModule,
    RealtimeModule,
    AuditModule,
    MailModule,
    LlmModule,
    ToolsModule,
    RuntimeModule,
  ],
})
export class CoreModule {}
