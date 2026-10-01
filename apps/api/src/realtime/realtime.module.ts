import { Global, Module } from '@nestjs/common';
import { RealtimeBus } from './realtime.bus';

@Global()
@Module({ providers: [RealtimeBus], exports: [RealtimeBus] })
export class RealtimeModule {}
