import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { ProjectsModule } from '../projects/projects.module';
import { PersonalBroadcastsController } from './personal-broadcasts.controller';
import { PersonalBroadcastsService } from './personal-broadcasts.service';
import { PersonalBroadcastsProcessor } from './personal-broadcasts.processor';
import { PersonalBroadcastsCron } from './personal-broadcasts.cron';

@Module({
  imports: [
    // Без limiter (в отличие от push-messages) — темп задаёт сам процессор через await sleep()
    // внутри одного длинного джоба на broadcast, не очередь (см. personal-broadcasts.processor.ts).
    BullModule.registerQueue({ name: 'personal-broadcast-messages' }),
    ProjectsModule,
    ChannelsModule,
  ],
  controllers: [PersonalBroadcastsController],
  providers: [PersonalBroadcastsService, PersonalBroadcastsProcessor, PersonalBroadcastsCron],
  exports: [PersonalBroadcastsService],
})
export class PersonalBroadcastsModule {}
