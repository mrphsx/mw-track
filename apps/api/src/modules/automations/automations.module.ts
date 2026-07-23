import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { AutomationEngineService } from './automation-engine.service';
import { AutomationStepProcessor } from './automation-step.processor';

// Намеренно НЕ импортирует ChannelsModule/ClientsModule/TrackingModule/ProjectsModule —
// AutomationEngineService резолвит ChannelsService, а AutomationsController — ProjectsService,
// лениво через ModuleRef (см. комментарии там). Прямой импорт ProjectsModule здесь ронял бут
// циклическим require() на уровне файлов: TrackingModule импортирует этот модуль, а
// ProjectsModule импортирует (пусть и через forwardRef) ChannelsModule, которая сама
// импортирует TrackingModule — тот же класс бага, что уже дважды был в этой сессии (см.
// AudienceModule/ClientsController), forwardRef защищает граф DI Nest, но не порядок
// исполнения обычных import/require при загрузке файлов.
@Module({
  imports: [BullModule.registerQueue({ name: 'automation-steps' })],
  controllers: [AutomationsController],
  providers: [AutomationsService, AutomationEngineService, AutomationStepProcessor],
  exports: [AutomationEngineService],
})
export class AutomationsModule {}
