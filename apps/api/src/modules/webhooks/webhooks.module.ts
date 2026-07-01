import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [ChannelsModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
