import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { TrackingModule } from '../tracking/tracking.module';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { TelegramProvider } from './providers/telegram.provider';
import { WhatsAppProvider } from './providers/whatsapp.provider';
import { InstagramProvider } from './providers/instagram.provider';

@Module({
  imports: [ClientsModule, TrackingModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, TelegramProvider, WhatsAppProvider, InstagramProvider],
  exports: [ChannelsService, TelegramProvider, WhatsAppProvider, InstagramProvider],
})
export class ChannelsModule {}
