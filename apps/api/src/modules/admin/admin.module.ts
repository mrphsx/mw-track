import { Module } from '@nestjs/common';
import { PushesModule } from '../pushes/pushes.module';
import { LandingsModule } from '../landings/landings.module';
import { DomainsModule } from '../domains/domains.module';
import { TeamModule } from '../team/team.module';
import { AdminController } from './admin.controller';
import { AdminCompanyController } from './admin-company.controller';
import { AdminService } from './admin.service';
import { AdminCompanyService } from './admin-company.service';
import { AdminCron } from './admin.cron';

// ПОДТВЕРЖДЁННЫЙ вживую циклический DI (Фаза 4.3B, 2026-07-20) — прямой импорт ProjectsModule
// напрямую в этот модуль ронял бут с "ClientsModule imports[0] is undefined", тот же класс
// ошибки, что уже 4 раза встречался в проекте (см. память про повторяющийся паттерн:
// ProjectsModule -(forwardRef)-> ChannelsModule -> ClientsModule -> ProjectsModule). Поэтому
// ProjectsModule/ClientsModule сюда НЕ импортируются — AdminCompanyService резолвит
// ProjectsService/ClientsService лениво через ModuleRef, тот же приём, что уже у
// AudienceService/AutomationsService. PushesModule/LandingsModule/DomainsModule/TeamModule
// вне этого цикла — обычный constructor injection для них подтверждён безопасным (PushesModule
// сам их импортирует так же, без проблем).
@Module({
  imports: [PushesModule, LandingsModule, DomainsModule, TeamModule],
  controllers: [AdminController, AdminCompanyController],
  providers: [AdminService, AdminCompanyService, AdminCron],
})
export class AdminModule {}
