import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

// Ретеншен журнала заблокированных клоакингом заходов (запрос пользователя 2026-09-25: "можно
// куда-то сохранять логи фильтрации... не перегрузит ли систему") — CloakingLog пишется на
// каждый реально заблокированный визит без deletedAt (чистый лог, не подлежащая восстановлению
// сущность, тот же прецедент, что PaymentDetailsLog/NotificationAlertState) — без этого крона
// таблица росла бы бесконечно. 30 дней достаточно для разбора инцидента задним числом, дальше
// строка только занимает место.
const RETENTION_DAYS = 30;

@Injectable()
export class LandingsCron {
  private readonly logger = new Logger(LandingsCron.name);

  constructor(private prisma: PrismaService) {}

  @Cron('30 3 * * *')
  async purgeOldCloakingLogs() {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.cloakingLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (count > 0) {
      this.logger.log(`purgeOldCloakingLogs: удалено ${count} логов клоакинга старше ${RETENTION_DAYS} дней`);
    }
  }
}
