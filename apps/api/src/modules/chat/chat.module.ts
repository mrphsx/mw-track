import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { ProjectsModule } from '../projects/projects.module';
import { ChatStoreModule } from './chat-store.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatAccessService } from './chat-access.service';
import { ChatAssignmentService } from './chat-assignment.service';
import { ChatOrganizeService } from './chat-organize.service';
import { ChatTemplatesService } from './chat-templates.service';
import { ChatScheduledService } from './chat-scheduled.service';
import { ChatFieldsService } from './chat-fields.service';
import { ChatStagesService } from './chat-stages.service';
import { ChatBroadcastService } from './chat-broadcast.service';
import { ChatSettingsCopyService } from './chat-settings-copy.service';
import { StorageService } from '../landings/storage.service';
import { TranslationModule } from '../translation/translation.module';

// Встроенный чат операторов (запрос пользователя 2026-10-23). ChannelsModule — ради
// TelegramProvider (отправка ответов, файлы переписки); сам ChannelsModule от этого модуля не
// зависит, пишет переписку через ChatStoreModule.
@Module({
  imports: [ChannelsModule, ProjectsModule, ChatStoreModule, TranslationModule],
  controllers: [ChatController],
  // StorageService — свой экземпляр (в LandingsModule он не экспортируется): приватный бакет MinIO для файлов шаблонов.
  providers: [ChatService, ChatAccessService, ChatAssignmentService, ChatOrganizeService, ChatTemplatesService, ChatScheduledService, ChatFieldsService, ChatStagesService, ChatBroadcastService, ChatSettingsCopyService, StorageService],
})
export class ChatModule {}
