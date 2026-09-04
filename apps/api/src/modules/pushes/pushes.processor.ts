import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { PushStatus } from '@prisma/client';
import { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelsService } from '../channels/channels.service';

@Processor('push-messages')
export class PushesProcessor {
  private readonly logger = new Logger(PushesProcessor.name);

  constructor(
    private prisma: PrismaService,
    private channelsService: ChannelsService,
  ) {}

  // pushLogId — строка уже существует (создана заранее в PushesService.ensureLedger), джоба
  // здесь только атомарно ЗАХВАТЫВАЕТ её (запрос пользователя 2026-09-01, "полноценный фикс" —
  // см. подробный разбор в комментарии у PushLog.status в schema.prisma). Раньше строка
  // создавалась реактивно прямо здесь (`pushLog.create`), из-за чего для получателей, чья джоба
  // так и не была поставлена в очередь до падения процесса, не оставалось вообще никакого следа.
  @Process('send-push-message')
  async sendPushMessage(job: Job<{ pushId: string; pushLogId: string; clientId: string }>) {
    const { pushId, pushLogId, clientId } = job.data;

    // Атомарный захват — если строка уже не 'pending' (реальная отправка кем-то другим уже
    // идёт/завершена: повторная джоба того же получателя от recoverStalledSending, случайный
    // Bull-дубль при stalled-детекте и т.п.), claimed.count===0 и джоба тихо выходит без
    // повторной отправки. Тот же приём, что PersonalBroadcastLog/JoinRequestApprovalProcessor.
    const claimed = await this.prisma.pushLog.updateMany({
      where: { id: pushLogId, status: 'pending' },
      data: { status: 'sending' },
    });
    if (claimed.count === 0) return;

    const [push, client] = await Promise.all([
      this.prisma.push.findUnique({ where: { id: pushId } }),
      this.prisma.client.findUnique({ where: { id: clientId } }),
    ]);

    // Push или клиент удалён между постановкой в очередь и обработкой — раньше это молча
    // выходило БЕЗ обновления лога/счётчиков, из-за чего audienceReachable никогда бы не
    // сходился и Push завис бы в SENDING точно так же, как и в исходном баге. Теперь считаем
    // это неудачной отправкой, чтобы арифметика sentCount+failedCount>=audienceReachable
    // по-прежнему сходилась.
    if (!push || !client) {
      await this.prisma.pushLog.update({ where: { id: pushLogId }, data: { status: 'failed', error: 'Push или клиент удалён' } });
      if (push) {
        const updated = await this.prisma.push.update({ where: { id: push.id }, data: { failedCount: { increment: 1 } } });
        if (updated.status === PushStatus.SENDING && updated.sentCount + updated.failedCount >= updated.audienceReachable) {
          await this.prisma.push.update({ where: { id: push.id }, data: { status: PushStatus.SENT } });
        }
      }
      return;
    }

    // 403 (бот заблокирован пользователем) уже обрабатывается внутри
    // TelegramProvider.sendMessage → ClientsService.markBotBlocked (шаг 1.5) —
    // здесь только фиксируем итог в PushLog и счётчиках Push.
    // Альбом (2-10 элементов) vs одиночное медиа (0-1) — см. CreatePushDto.messageMedia.
    // mediaUrl/mediaType всегда дублируют первый элемент, даже когда это альбом: провайдеры
    // без поддержки mediaGroup (WhatsApp/Instagram) просто читают их и шлют один файл —
    // деградация автоматическая, без доп. кода в тех провайдерах (см. интерфейс).
    const media = push.messageMedia as { type: 'photo' | 'video' | 'video_note' | 'voice'; url: string }[] | null;
    const mediaGroup = media && media.length > 1 ? media.map((m) => ({ type: m.type as 'photo' | 'video', url: m.url })) : undefined;
    // Прямая ссылка на кнопке (отказ от трекинг-редиректа, запрос пользователя 2026-07-17:
    // "ссылка на кнопке не та что я поставил ... лучше напрямую") — раньше URL кнопки
    // подменялся на /track/push/:logId?url=... для подсчёта CTR по часам (Smart Push
    // Timing, Фаза 3.4). Пользователь сознательно выбрал прямую ссылку в обмен на потерю
    // этой аналитики для новых пушей — сам эндпоинт-редирект и PushLog.clickedAt оставлены
    // как есть (не удалены), просто больше не используются для новых отправок; исторические
    // данные CTR-by-hour по старым пушам не трогаем.
    const buttons = push.buttons as { text: string; url?: string }[] | undefined;
    const result = await this.channelsService.sendMessage(client, {
      text: push.messageText,
      mediaUrl: media?.[0]?.url,
      mediaType: media?.[0]?.type,
      mediaGroup,
      buttons,
    });

    // Реальный текст ошибки (не заглушка "send failed") — запрос пользователя 2026-07-17
    // "добавь логи ошибок при открытии рассылки": PushLog.error теперь показывает то, что
    // реально ответил Telegram/WhatsApp/Instagram (см. SendMessageResult), а не общую фразу.
    await this.prisma.pushLog.update({
      where: { id: pushLogId },
      data: {
        status: result.success ? 'sent' : 'failed',
        sentAt: result.success ? new Date() : null,
        error: result.success ? null : result.error || 'Неизвестная ошибка отправки',
      },
    });

    // deliveredCount не инкрементируется здесь: Bot API не даёт подтверждения доставки
    // (в отличие от sentCount — это просто "запрос к Telegram прошёл успешно"), а заявлять
    // delivered без реального сигнала было бы вводящей в заблуждение статистикой.
    const updated = await this.prisma.push.update({
      where: { id: push.id },
      data: result.success ? { sentCount: { increment: 1 } } : { failedCount: { increment: 1 } },
    });

    if (updated.status === PushStatus.SENDING && updated.sentCount + updated.failedCount >= updated.audienceReachable) {
      await this.prisma.push.update({ where: { id: push.id }, data: { status: PushStatus.SENT } });
    }
  }
}
