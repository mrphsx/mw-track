import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { TrackingModule } from '../tracking/tracking.module';
import { FunnelModule } from '../funnel/funnel.module';
import { ChatStoreModule } from '../chat/chat-store.module';
import { ProjectsModule } from '../projects/projects.module';
import { ExtApiController, ExtApiLogsController } from './ext-api.controller';
import { ExtApiService } from './ext-api.service';

@Module({
  imports: [ClientsModule, TrackingModule, FunnelModule, ChatStoreModule, ProjectsModule],
  controllers: [ExtApiController, ExtApiLogsController],
  providers: [ExtApiService],
})
export class ExtApiModule {}
