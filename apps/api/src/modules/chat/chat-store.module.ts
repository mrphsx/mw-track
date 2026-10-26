import { Module } from '@nestjs/common';
import { ChatStoreService } from './chat-store.service';
import { ChatStagesEngine } from './chat-stages.engine';

// Только запись переписки, без зависимостей от других модулей — см. комментарий в
// chat-store.service.ts про цикл ChannelsModule ↔ ChatModule.
// ChatStagesEngine (этапы лида, 2026-10-25) — здесь же и по той же причине: его зовут и запись
// переписки, и PurchasesService, и чат.
@Module({
  providers: [ChatStoreService, ChatStagesEngine],
  exports: [ChatStoreService, ChatStagesEngine],
})
export class ChatStoreModule {}
