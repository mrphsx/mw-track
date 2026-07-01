import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { TrackingProcessor } from './tracking.processor';
import { FacebookCAPIService } from './facebook-capi.service';
import { TikTokEventsService } from './tiktok-events.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'tracking-events' }), ProjectsModule],
  controllers: [TrackingController],
  providers: [TrackingService, TrackingProcessor, FacebookCAPIService, TikTokEventsService],
  exports: [TrackingService],
})
export class TrackingModule {}
