import { Module, forwardRef } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

// forwardRef — ChannelsModule импортирует ClientsModule/TrackingModule, оба из которых сами
// импортируют ProjectsModule (нужен им для своих сервисов), так что прямой import ChannelsModule
// здесь замыкает цикл ProjectsModule -> ChannelsModule -> ClientsModule -> ProjectsModule.
@Module({
  imports: [forwardRef(() => ChannelsModule)],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
