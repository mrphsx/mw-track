import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { ProjectsModule } from '../projects/projects.module';
import { StoriesController, StoriesOverviewController } from './stories.controller';
import { StoriesService } from './stories.service';
import { StoriesCron } from './stories.cron';

@Module({
  imports: [ProjectsModule, ChannelsModule],
  controllers: [StoriesOverviewController, StoriesController],
  providers: [StoriesService, StoriesCron],
  exports: [StoriesService],
})
export class StoriesModule {}
