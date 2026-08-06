import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PushStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { checkSubscriptionLimit } from '../../common/guards/subscription.util';
import { PushesService } from './pushes.service';

// Порог, после которого просроченный (заблокированный лимитом подписки) SCHEDULED-пуш
// окончательно помечается FAILED, а не продолжает молча ждать следующего тика — дневной лимит
// сбрасывается скользящим окном (resetDailyPushLimits, было "месяца" до 2026-07-30, см.
// pushes.service.ts), просрочка плана продлевается автопродлением (BillingCron, каждые 15 мин) —
// оба МОГУТ решиться сами, поэтому не глушим пуш первой же неудачной попыткой (запрос
// пользователя 2026-07-18). Оставлено 24ч и после перевода лимита на дневной (тот же порядок,
// что и сам цикл сброса теперь) — грейс в первую очередь про автопродление плана, а не про сам
// сброс счётчика; с дневным лимитом у счётчика-блока теперь даже больше шансов реально
// разрешиться в течение грейса, чем раньше с 30-дневным окном.
const SCHEDULED_PUSH_GRACE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PushesCron {
  private readonly logger = new Logger(PushesCron.name);

  constructor(
    private prisma: PrismaService,
    private pushesService: PushesService,
  ) {}

  @Cron('0 0 * * *') // раз в сутки
  async resetDailyPushLimits() {
    await this.pushesService.resetDailyPushLimits();
  }

  // Срабатывание отложенных рассылок (запрос пользователя 2026-07-18, "программировать
  // рассылки на потом") — Push.scheduledAt/PushStatus.SCHEDULED существовали в схеме и в DTO
  // и раньше, но ничего не проверяло наступившие сроки. Раз в минуту — разумная гранулярность
  // для "на 14:32", не должна заметно опаздывать; процесс одиночный (PM2 без cluster-режима),
  // гонок между несколькими инстансами крона нет, рестарт между тиками не теряет пуши —
  // следующий тик подхватит по тому же условию scheduledAt<=now(), как и остальные краны
  // здесь.
  @Cron('*/1 * * * *')
  async fireScheduledPushes() {
    const due = await this.prisma.push.findMany({
      where: { status: PushStatus.SCHEDULED, scheduledAt: { lte: new Date() } },
      include: { project: { select: { id: true, companyId: true } } },
    });
    if (due.length === 0) return;

    for (const push of due) {
      const company = await this.prisma.company.findUnique({ where: { id: push.project.companyId } });
      if (!company) continue;

      const { blocked, reason } = checkSubscriptionLimit(company, 'pushes');
      if (blocked) {
        const overdueMs = Date.now() - push.scheduledAt!.getTime();
        if (overdueMs >= SCHEDULED_PUSH_GRACE_MS) {
          this.logger.warn(`Push ${push.id} failed after grace period, still blocked: ${reason}`);
          await this.prisma.push.update({ where: { id: push.id }, data: { status: PushStatus.FAILED } });
        } else {
          this.logger.warn(`Push ${push.id} due but blocked (${reason}), retrying next tick`);
        }
        continue;
      }

      try {
        // requireDueBy — перепроверяет срок ПРЯМО в момент атомарного захвата внутри send(),
        // на случай если пользователь успел перенести дату между findMany выше и этим вызовом.
        await this.pushesService.send(push.id, push.project.id, push.project.companyId, push.scheduledAt!);
      } catch (error) {
        // Захват не удался (count===0) — скорее всего кто-то уже отправил пуш вручную
        // в этом же промежутке, не настоящая ошибка.
        this.logger.warn(`fireScheduledPushes: send() skipped for push ${push.id}: ${(error as Error).message}`);
      }
    }
  }

  // SubscriptionGuard (шаг 1.3) уже блокирует доступ в реальном времени по
  // company.planExpiresAt — этому крону не нужно (и не должно) повторять ту проверку.
  // Его задача — то, чего guard не делает: видимость для опс + отключение каналов,
  // чтобы боты не продолжали отвечать клиентам истёкшей компании в фоне
  // (вебхуки публичные, guard их не защищает).
  @Cron('0 * * * *') // каждый час
  async checkExpiredSubscriptions() {
    const expired = await this.prisma.company.findMany({
      where: { planExpiresAt: { lt: new Date() }, plan: { not: 'TRIAL' } },
      include: { projects: { include: { channel: true } } },
    });

    for (const company of expired) {
      this.logger.warn(`Company ${company.id} (${company.name}) subscription expired at ${company.planExpiresAt}`);

      for (const project of company.projects) {
        if (project.channel?.isActive) {
          await this.prisma.channel.update({ where: { id: project.channel.id }, data: { isActive: false } });
        }
      }
    }
  }
}
