import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

const ERROR_LOG_RETENTION_DAYS = 30;

@Injectable()
export class AdminCron {
  private readonly logger = new Logger(AdminCron.name);

  constructor(private prisma: PrismaService) {}

  // Ретеншн ErrorLog (Фаза 4.3, запрос пользователя 2026-07-19) — в приложении нет rate
  // limiting ни на одном публичном роуте (tracking/webhooks), значит нет верхней границы на
  // количество ошибок от одного источника; без чистки таблица росла бы неограниченно.
  @Cron('0 3 * * *') // раз в сутки, вне пиковых часов
  async pruneErrorLogs() {
    const cutoff = new Date(Date.now() - ERROR_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.errorLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (count > 0) this.logger.log(`pruneErrorLogs: удалено ${count} записей старше ${ERROR_LOG_RETENTION_DAYS} дней`);
  }
}
