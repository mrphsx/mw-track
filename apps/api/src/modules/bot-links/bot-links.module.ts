import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { BotLinksController } from './bot-links.controller';
import { BotLinksService } from './bot-links.service';

@Module({
  imports: [ProjectsModule],
  controllers: [BotLinksController],
  providers: [BotLinksService],
})
export class BotLinksModule {}
