import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ChannelsModule } from '../channels/channels.module';
import { LandingsController } from './landings.controller';
import { ProjectLandingsController } from './project-landings.controller';
import { AbTestGroupsController } from './ab-test-groups.controller';
import { InternalController } from './internal.controller';
import { LandingsService } from './landings.service';
import { LandingRendererService } from './landing-renderer.service';
import { NginxService } from './nginx.service';
import { StorageService } from './storage.service';

// ChannelsModule — LandingsService.publish() создаёт персональную invite-ссылку лендинга
// через TelegramProvider (см. Client.landingId, пер-лендинговая атрибуция подписчиков).
// Не циклическая зависимость: ChannelsModule (через ClientsModule/TrackingModule) тянет
// ProjectsModule, но не LandingsModule — цикл не замыкается.
@Module({
  imports: [ProjectsModule, ChannelsModule],
  controllers: [LandingsController, ProjectLandingsController, AbTestGroupsController, InternalController],
  providers: [LandingsService, LandingRendererService, NginxService, StorageService],
  // LandingRendererService — экспортирован для AdminModule (превью лендинга в дрилл-дауне
  // компании, см. AdminCompanyService.getLandingPreview), не только внутримодульное использование.
  exports: [LandingsService, NginxService, LandingRendererService],
})
export class LandingsModule {}
