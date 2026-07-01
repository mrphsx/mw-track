import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { ClientsModule } from '../clients/clients.module';
import { ProjectsModule } from '../projects/projects.module';
import { PushesController } from './pushes.controller';
import { PushesService } from './pushes.service';
import { PushesProcessor } from './pushes.processor';
import { PushesCron } from './pushes.cron';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'push-messages',
      limiter: { max: 30, duration: 1000 }, // Telegram: до 30 сообщений/сек на бот (см. 09_BACKEND_PUSHES.md)
    }),
    ProjectsModule,
    ClientsModule,
    ChannelsModule,
  ],
  controllers: [PushesController],
  providers: [PushesService, PushesProcessor, PushesCron],
  exports: [PushesService],
})
export class PushesModule {}
