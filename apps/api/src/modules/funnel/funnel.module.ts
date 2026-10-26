import { Module } from '@nestjs/common';
import { FunnelConfigService } from './funnel-config.service';

// Только Prisma — импортируется и ChannelsModule (обработчики Telegram), и ProjectsModule
// (сохранение настройки), без новых связей между ними.
@Module({
  providers: [FunnelConfigService],
  exports: [FunnelConfigService],
})
export class FunnelModule {}
