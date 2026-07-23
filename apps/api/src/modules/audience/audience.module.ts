import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AudienceController } from './audience.controller';
import { AudienceService } from './audience.service';

// Не импортирует ProjectsModule — AudienceService резолвит ProjectsService лениво через
// ModuleRef (см. комментарий там). Прямой импорт ProjectsModule здесь ронял бут: из-за
// алфавитного порядка import в app.module.ts AudienceModule оказывался первой точкой входа
// в существующий цикл ProjectsModule-(forwardRef)->ChannelsModule->ClientsModule->ProjectsModule.
@Module({
  imports: [PrismaModule],
  controllers: [AudienceController],
  providers: [AudienceService],
})
export class AudienceModule {}
