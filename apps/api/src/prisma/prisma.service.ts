import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { companyStorage } from '../common/context/company.context';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();

    // Middleware для автоматической фильтрации по company_id.
    // Применяется только к моделям, у которых реально есть колонка companyId
    // (см. prisma/schema.prisma). Push/Purchase/TrackingEvent в схеме 02_DATABASE.md
    // несут только projectId — для них scoping должен идти через
    // `where: { project: { companyId } }` на уровне сервиса, когда эти модули появятся,
    // а не через этот generic middleware (иначе Prisma бросит Unknown argument `companyId`).
    // Domain сюда не входит по той же причине, что и Channel (см. CLAUDE.md): у обоих моделей
    // нет колонки deletedAt — авто-инъекция `deletedAt: null` ниже привела бы к Unknown argument.
    // DomainsService сам явно фильтрует по companyId на каждый запрос.
    this.$use(async (params, next) => {
      const modelsWithCompany = ['Project', 'Landing', 'Client', 'BotScenario', 'AutomationFlow', 'AbTestGroup', 'StoryPost'];

      if (params.model && modelsWithCompany.includes(params.model)) {
        const ctx = companyStorage.getStore();

        if (ctx) {
          // Для операций чтения — добавить фильтр
          if (['findFirst', 'findMany', 'count', 'aggregate'].includes(params.action)) {
            params.args = params.args || {};
            params.args.where = {
              ...params.args.where,
              companyId: ctx.companyId,
              deletedAt: null, // soft delete
            };
          }

          // Для создания — добавить companyId
          if (params.action === 'create') {
            params.args.data = {
              ...params.args.data,
              companyId: ctx.companyId,
            };
          }

          // Для обновления/удаления — проверить владельца
          if (['update', 'delete'].includes(params.action)) {
            params.args.where = {
              ...params.args.where,
              companyId: ctx.companyId,
            };
          }
        }
      }

      return next(params);
    });
  }
}
