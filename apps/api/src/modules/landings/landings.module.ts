import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { LandingsController } from './landings.controller';
import { ProjectLandingsController } from './project-landings.controller';
import { InternalController } from './internal.controller';
import { LandingsService } from './landings.service';
import { LandingRendererService } from './landing-renderer.service';
import { NginxService } from './nginx.service';
import { StorageService } from './storage.service';

@Module({
  imports: [ProjectsModule],
  controllers: [LandingsController, ProjectLandingsController, InternalController],
  providers: [LandingsService, LandingRendererService, NginxService, StorageService],
  exports: [LandingsService, NginxService],
})
export class LandingsModule {}
