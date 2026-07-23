import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { EncryptionService } from '../../common/encryption.service';
import { ClientsModule } from '../clients/clients.module';
import { TrackingModule } from '../tracking/tracking.module';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ChannelMediaService } from './channel-media.service';
import { VideoProcessingService } from './video-processing.service';
import { BotScenariosController } from './bot-scenarios.controller';
import { BotScenariosService } from './bot-scenarios.service';
import { TelegramProvider } from './providers/telegram.provider';
import { TelegramPersonalService } from './providers/telegram-personal.service';
import { WhatsAppProvider } from './providers/whatsapp.provider';
import { InstagramProvider } from './providers/instagram.provider';
import { JoinRequestApprovalProcessor } from './join-request-approval.processor';
import { BotScenarioMessageProcessor } from './bot-scenario-message.processor';

@Module({
  imports: [
    ClientsModule,
    TrackingModule,
    // Задержка одобрения заявки на вступление (Channel.tgJoinDelaySeconds) — см.
    // TelegramProvider.approveJoinRequestMaybeDelayed / JoinRequestApprovalProcessor.
    BullModule.registerQueue({ name: 'join-request-approval' }),
    // Отложенная отправка сообщений сценариев (BotScenario.delaySeconds) — см.
    // TelegramProvider.triggerScenario / BotScenarioMessageProcessor.
    BullModule.registerQueue({ name: 'bot-scenario-message' }),
  ],
  controllers: [ChannelsController, BotScenariosController],
  providers: [
    ChannelsService,
    ChannelMediaService,
    VideoProcessingService,
    BotScenariosService,
    TelegramProvider,
    TelegramPersonalService,
    EncryptionService,
    WhatsAppProvider,
    InstagramProvider,
    JoinRequestApprovalProcessor,
    BotScenarioMessageProcessor,
  ],
  // ChannelMediaService экспортирован дополнительно (запрос пользователя 2026-07-17,
  // "загружать медиа для рассылок") — PushesModule уже импортирует ChannelsModule (см.
  // pushes.module.ts), новой связи в графе модулей это не добавляет, поэтому переиспользуем
  // существующий MinIO-обёртку вместо третьей копии (см. комментарий в channel-media.service.ts
  // про уже существующее дублирование ради обхода циклов — здесь цикла нет, дублировать не за чем).
  exports: [ChannelsService, TelegramProvider, TelegramPersonalService, WhatsAppProvider, InstagramProvider, ChannelMediaService, VideoProcessingService],
})
export class ChannelsModule {}
