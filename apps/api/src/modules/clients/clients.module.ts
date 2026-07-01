import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { TrackingModule } from '../tracking/tracking.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientsRepository } from './clients.repository';
import { PurchasesService } from './purchases.service';

@Module({
  imports: [ProjectsModule, TrackingModule],
  controllers: [ClientsController],
  providers: [ClientsService, ClientsRepository, PurchasesService],
  exports: [ClientsService, PurchasesService],
})
export class ClientsModule {}
