import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { AutomationsModule } from '../automations/automations.module';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { TrackingProcessor } from './tracking.processor';
import { FacebookCAPIService } from './facebook-capi.service';
import { TikTokEventsService } from './tiktok-events.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'tracking-events' }), ProjectsModule, AutomationsModule],
  controllers: [TrackingController],
  providers: [TrackingService, TrackingProcessor, FacebookCAPIService, TikTokEventsService],
  // FacebookCAPIService/TikTokEventsService экспортированы (запрос пользователя 2026-07-29,
  // "проверка ивента" при создании пикселя) — PixelsService шлёт разовое тестовое событие тем
  // же кодом, что и настоящая отправка, без похода через TrackingService.recordEvent (пикселя
  // формы ещё может не существовать в БД на момент проверки, только что введённые в форме
  // pixelId/accessToken).
  exports: [TrackingService, FacebookCAPIService, TikTokEventsService],
})
export class TrackingModule {}
