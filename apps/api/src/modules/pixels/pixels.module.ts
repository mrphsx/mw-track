import { Module } from '@nestjs/common';
import { TrackingModule } from '../tracking/tracking.module';
import { PixelsController } from './pixels.controller';
import { PixelsService } from './pixels.service';

@Module({
  // TrackingModule — для проверки ивента при создании пикселя (запрос пользователя
  // 2026-07-29), PixelsService шлёт тест напрямую через FacebookCAPIService/TikTokEventsService.
  // Не создаёт цикла: TrackingModule (через ProjectsModule/AutomationsModule) нигде не
  // импортирует PixelsModule обратно.
  imports: [TrackingModule],
  controllers: [PixelsController],
  providers: [PixelsService],
  exports: [PixelsService],
})
export class PixelsModule {}
