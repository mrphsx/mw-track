import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { TrackingModule } from '../tracking/tracking.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientsRepository } from './clients.repository';
import { PurchasesService } from './purchases.service';
import { ChatStoreModule } from '../chat/chat-store.module';

@Module({
  imports: [ProjectsModule, TrackingModule, ChatStoreModule],
  controllers: [ClientsController],
  providers: [ClientsService, ClientsRepository, PurchasesService],
  exports: [ClientsService, PurchasesService],
})
export class ClientsModule {}
