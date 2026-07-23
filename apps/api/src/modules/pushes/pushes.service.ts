import { InjectQueue } from '@nestjs/bull';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Push, PushStatus } from '@prisma/client';
import { Queue } from 'bull';
import { subDays } from 'date-fns';
import { nanoid } from 'nanoid';
import type { Readable } from 'stream';
import { PrismaService } from '../../prisma/prisma.service';
import { dailyBucketSql, hourBucketSql } from '../../common/timezone.util';
import { ClientsService } from '../clients/clients.service';
import { PushFilterDto } from '../clients/dto/push-filter.dto';
import { ChannelMediaService } from '../channels/channel-media.service';
import { VideoProcessingService } from '../channels/video-processing.service';
import { CreatePushDto } from './dto/create-push.dto';
import { UpdatePushDto } from './dto/update-push.dto';

const EDITABLE_STATUSES: PushStatus[] = [PushStatus.DRAFT, PushStatus.SCHEDULED];
const MAX_PUSH_MEDIA_SIZE = 50 * 1024 * 1024;
// Жёсткий лимит самого Telegram Bot API для sendVideoNote (12582912 байт ровно) — сильно
// меньше нашего общего лимита в 50MB. Без отдельной проверки загрузка проходила успешно,
// а реальная отправка кружка падала уже на шаге sendVideoNote с невнятной для пользователя
// ошибкой (баг, репорт пользователя 2026-07-17: "получил ошибку, mrphsx не получил
// сообщение" — video_note на 20.5MB).
const MAX_VIDEO_NOTE_SIZE = 12 * 1024 * 1024;

@Injectable()
export class PushesService {
  constructor(
    private prisma: PrismaService,
    private clientsService: ClientsService,
    private media: ChannelMediaService,
    private videoProcessing: VideoProcessingService,
    private config: ConfigService,
    @InjectQueue('push-messages') private pushQueue: Queue,
  ) {}

  // Загрузка медиа с устройства (запрос пользователя 2026-07-17: "загружать медиа файлы с
  // устройства") — до этого поле принимало только готовый URL. Ключ плоский (nanoid, без
  // вложенности по projectId/pushId) — на момент загрузки черновик рассылки может ещё не быть
  // создан (загрузка происходит на шаге "Контент", до POST /pushes), поэтому не привязываемся
  // к id пуша. Публичный URL — прокси через собственный API (тот же приём, что уже
  // используется для welcome-media/scenario-media, см. ChannelMediaService) — бакет приватный,
  // Telegram фетчит эту ссылку напрямую при реальной отправке (bot.api.sendPhoto/sendVideo).
  async uploadMedia(file?: Express.Multer.File, mediaType?: string): Promise<{ url: string; key: string }> {
    if (!file) throw new BadRequestException('Файл не передан');
    if (file.size > MAX_PUSH_MEDIA_SIZE) throw new BadRequestException('Файл слишком большой (макс. 50MB)');

    // Кружок рендерится кругом только если видео уже квадратное (1:1) — Telegram это не
    // проверяет сам, просто показывает как обычное видео (баг, репорт пользователя
    // 2026-07-17). Обрезаем по центру до квадрата (+ до 60 сек) здесь, ДО проверки лимита
    // в 12MB — обрезка почти всегда уменьшает размер файла, так что исходные 15-20MB
    // прямоугольного видео вполне могут пройти после обрезки, а проверять исходный размер
    // заранее значило бы отклонять то, что реально прошло бы.
    let buffer = file.buffer;
    if (mediaType === 'video_note') {
      buffer = await this.videoProcessing.ensureSquareVideoNote(buffer);
      if (buffer.length > MAX_VIDEO_NOTE_SIZE) {
        throw new BadRequestException('Видео для кружка слишком большое даже после обрезки (макс. 12MB у Telegram) — выберите файл покороче или полегче');
      }
    }

    // Ключ без "/" намеренно (не push-media/<id>, а push-media_<id>) — иначе он занимал бы
    // два сегмента URL-пути в публичном роуте раздачи ниже, требуя wildcard-параметр и лишней
    // возни с %2F-кодированием ради простой раздачи одного файла.
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `push-media_${nanoid(16)}-${safeName}`;
    await this.media.uploadBuffer(key, buffer, file.mimetype);

    const apiUrl = this.config.get<string>('API_URL');
    return { url: `${apiUrl}/api/v1/pushes-media/${key}`, key };
  }

  async streamMedia(key: string): Promise<{ stream: Readable; contentType?: string; size?: number }> {
    const [stream, stat] = await Promise.all([this.media.getObjectStream(key), this.media.getStat(key)]);
    return { stream, contentType: stat?.contentType, size: stat?.size };
  }

  private async previewAudience(projectId: string, filter: PushFilterDto) {
    const [audienceTotal, audienceReachable] = await Promise.all([
      this.clientsService.countAudienceTotal(projectId, filter),
      this.clientsService.countPushAudience(projectId, filter),
    ]);
    return { audienceTotal, audienceReachable };
  }

  // Bot API sendMediaGroup не принимает video_note (кружки идут только одиночным
  // sendVideoNote) — при 2+ элементах ни один не может быть кружком.
  private assertValidMedia(media?: { type: string; url: string }[]) {
    if (media && media.length > 1 && media.some((m) => m.type === 'video_note')) {
      throw new BadRequestException('Кружок нельзя отправить вместе с другими медиафайлами в одной рассылке');
    }
  }

  async create(projectId: string, dto: CreatePushDto): Promise<Push> {
    this.assertValidMedia(dto.messageMedia);
    const { audienceTotal, audienceReachable } = await this.previewAudience(projectId, dto.filter);

    return this.prisma.push.create({
      data: {
        projectId,
        name: dto.name,
        messageText: dto.messageText,
        messageMedia: (dto.messageMedia as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        buttons: (dto.buttons as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        filter: dto.filter as unknown as Prisma.InputJsonValue,
        audienceTotal,
        audienceReachable,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        status: dto.scheduledAt ? PushStatus.SCHEDULED : PushStatus.DRAFT,
      },
    });
  }

  async findAll(projectId: string): Promise<Push[]> {
    return this.prisma.push.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string, projectId: string): Promise<Push> {
    const push = await this.prisma.push.findFirst({ where: { id, projectId } });
    if (!push) throw new NotFoundException('Пуш не найден');
    return push;
  }

  async update(id: string, projectId: string, dto: UpdatePushDto): Promise<Push> {
    this.assertValidMedia(dto.messageMedia);
    const push = await this.findOne(id, projectId);
    this.assertEditable(push);

    const filterChanged = !!dto.filter;
    const recalculated = filterChanged ? await this.previewAudience(projectId, dto.filter!) : {};

    // Раньше scheduledAt сохранялся, а status никогда не трогался — PATCH существующего
    // DRAFT-пуша с датой не переводил его в SCHEDULED, крон отложенных рассылок его бы
    // никогда не увидел (запрос пользователя 2026-07-18). null — явное снятие расписания
    // обратно в черновик (см. UpdatePushDto); undefined — оставляем как есть.
    const scheduling =
      dto.scheduledAt === null
        ? { scheduledAt: null, status: PushStatus.DRAFT }
        : dto.scheduledAt !== undefined
          ? { scheduledAt: new Date(dto.scheduledAt), status: PushStatus.SCHEDULED }
          : {};

    return this.prisma.push.update({
      where: { id },
      data: {
        name: dto.name,
        messageText: dto.messageText,
        messageMedia: dto.messageMedia !== undefined ? (dto.messageMedia as unknown as Prisma.InputJsonValue) : undefined,
        buttons: dto.buttons !== undefined ? (dto.buttons as unknown as Prisma.InputJsonValue) : undefined,
        filter: filterChanged ? (dto.filter as unknown as Prisma.InputJsonValue) : undefined,
        ...scheduling,
        ...recalculated,
      },
    });
  }

  // Пересчёт по уже сохранённому фильтру — состав клиентов мог измениться
  // (новые подписчики, кто-то заблокировал бота) с момента создания черновика
  async recalculateAudience(id: string, projectId: string): Promise<Push> {
    const push = await this.findOne(id, projectId);
    this.assertEditable(push);

    const { audienceTotal, audienceReachable } = await this.previewAudience(
      projectId,
      push.filter as unknown as PushFilterDto,
    );
    return this.prisma.push.update({ where: { id }, data: { audienceTotal, audienceReachable } });
  }

  // Сводка для календаря на странице создания рассылки (запрос пользователя 2026-07-18) —
  // отдаёт ТОЛЬКО {дата, количество} по одному месяцу, никогда не сами пуши списком: календарь
  // не должен тянуть всю историю независимо от того, сколько пушей накопилось за месяцы
  // работы проекта. Группировка по таймзоне ПРОЕКТА, не по сырому UTC (та же идиома, что и
  // getBestTimeStats выше, и clients.repository.ts) — иначе пуш на "20-е, 23:30" в проекте
  // с ненулевым смещением зоны мог бы утечь на 21-е число на календаре.
  async getScheduledSummary(projectId: string, month: string): Promise<{ date: string; count: number }[]> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true } });
    const dateBucket = dailyBucketSql('scheduledAt', project.timezone);
    const monthStart = `${month}-01`;

    const rows = await this.prisma.$queryRaw<{ date: Date; count: bigint }[]>`
      SELECT ${dateBucket} as date, COUNT(*)::int as count
      FROM "Push"
      WHERE "projectId" = ${projectId}
        AND status = 'SCHEDULED'
        AND "scheduledAt" >= (${monthStart}::date) AT TIME ZONE ${project.timezone}
        AND "scheduledAt" < (${monthStart}::date + interval '1 month') AT TIME ZONE ${project.timezone}
      GROUP BY date
      ORDER BY date ASC
    `;

    return rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), count: Number(r.count) }));
  }

  // Тот же календарь, но по всей компании сразу (запрос пользователя 2026-07-19, "так же можно
  // и глобальный календарь такой под все проекты") — projectIds уже отфильтрован вызывающей
  // стороной под доступные пользователю проекты (ProjectsService.getAccessibleProjectIds,
  // Buyer/Operator видят только свои). В отличие от getScheduledSummary выше, тут у каждой
  // строки СВОЙ часовой пояс (у каждого проекта свой Project.timezone) — dailyBucketSql не
  // подходит (параметризует одну зону на весь запрос), поэтому таймзона берётся прямо из
  // присоединённой таблицы "Project"."timezone" как raw-выражение справа от AT TIME ZONE —
  // Postgres это поддерживает наравне с литералом. Группировка/фильтр по месяцу — уже на
  // вычисленной колонке (bucket.date), а не на сыром "scheduledAt", поэтому не нужно возиться
  // с "запасом" на границах месяца под разные смещения зон сразу.
  async getGlobalScheduledSummary(projectIds: string[], month: string): Promise<{ date: string; count: number }[]> {
    if (projectIds.length === 0) return [];
    const monthStart = `${month}-01`;

    const rows = await this.prisma.$queryRaw<{ date: Date; count: bigint }[]>`
      SELECT bucket.date, COUNT(*)::int as count
      FROM (
        SELECT ("Push"."scheduledAt" AT TIME ZONE 'UTC' AT TIME ZONE "Project"."timezone")::date as date
        FROM "Push"
        JOIN "Project" ON "Project"."id" = "Push"."projectId"
        WHERE "Push"."status" = 'SCHEDULED' AND "Push"."projectId" IN (${Prisma.join(projectIds)})
      ) bucket
      WHERE bucket.date >= ${monthStart}::date AND bucket.date < (${monthStart}::date + interval '1 month')
      GROUP BY bucket.date
      ORDER BY bucket.date ASC
    `;

    return rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), count: Number(r.count) }));
  }

  // Список самих рассылок на конкретный день (не только количество) — запрос пользователя
  // 2026-07-19 "видеть на когда уже есть рассылки и сколько" буквально: количество из
  // getScheduledSummary/getGlobalScheduledSummary отвечает "сколько", этот метод — "какие
  // именно". Один и тот же метод обслуживает и календарь внутри проекта (вызывается с
  // projectIds: [projectId]), и глобальный (список всех доступных) — ограничен ОДНИМ днём,
  // поэтому дёшев независимо от объёма истории.
  async getScheduledForDay(
    projectIds: string[],
    date: string,
  ): Promise<{ id: string; name: string; scheduledAt: Date; projectId: string; projectName: string }[]> {
    if (projectIds.length === 0) return [];

    return this.prisma.$queryRaw<{ id: string; name: string; scheduledAt: Date; projectId: string; projectName: string }[]>`
      SELECT "Push"."id", "Push"."name", "Push"."scheduledAt", "Push"."projectId", "Project"."name" as "projectName"
      FROM "Push"
      JOIN "Project" ON "Project"."id" = "Push"."projectId"
      WHERE "Push"."status" = 'SCHEDULED'
        AND "Push"."projectId" IN (${Prisma.join(projectIds)})
        AND ("Push"."scheduledAt" AT TIME ZONE 'UTC' AT TIME ZONE "Project"."timezone")::date = ${date}::date
      ORDER BY "Push"."scheduledAt" ASC
    `;
  }

  // Лимит "сколько пушей в месяц" проверен @SubscriptionLimit('pushes') на контроллере
  // ДО вызова этого метода (для ручного HTTP-пути) — здесь только инкремент счётчика
  // использования. Для крона отложенных рассылок (PushesCron.fireScheduledPushes) та же
  // проверка выполняется вызывающей стороной через checkSubscriptionLimit до вызова send().
  //
  // requireDueBy — только для вызова из крона (запрос пользователя 2026-07-18, "программировать
  // рассылки на потом"): захват пуша атомарный (updateMany с условием в WHERE, а не
  // read-then-write) по двум причинам сразу — (1) пользователь мог в этот момент нажать
  // "Отправить сейчас" вручную на том же SCHEDULED-пуше, которым как раз занялся крон, без
  // атомарности оба могли пройти проверку статуса до того, как один из них закоммитит
  // SENDING, и аудитория получила бы рассылку дважды; (2) пользователь мог успеть перенести
  // scheduledAt на будущее время в промежутке между тем, как крон прочитал список просроченных
  // пушей, и тем, как дошёл до вызова send() для конкретного — requireDueBy перепроверяет
  // срок ПРЯМО в момент захвата, а не по устаревшему снимку.
  async send(id: string, projectId: string, companyId: string, requireDueBy?: Date): Promise<Push> {
    const push = await this.findOne(id, projectId);

    const claimed = await this.prisma.push.updateMany({
      where: {
        id,
        status: { in: EDITABLE_STATUSES },
        ...(requireDueBy ? { scheduledAt: { lte: requireDueBy } } : {}),
      },
      data: { status: PushStatus.SENDING, sentAt: new Date() },
    });
    if (claimed.count === 0) throw new ForbiddenException('Пуш уже отправляется или отправлен');

    const updated = await this.prisma.push.findUniqueOrThrow({ where: { id } });

    await this.prisma.company.update({
      where: { id: companyId },
      data: { pushesThisMonth: { increment: 1 } },
    });

    // Аудитория с нулевым размером — сразу SENT, иначе процессор никогда не увидит
    // sentCount+failedCount >= audienceReachable (0 >= 0 уже true, но джобов не будет,
    // которые могли бы это проверить)
    if (updated.audienceReachable === 0) {
      return this.prisma.push.update({ where: { id }, data: { status: PushStatus.SENT } });
    }

    for await (const chunk of this.clientsService.getClientsForPushInChunks(
      projectId,
      push.filter as unknown as PushFilterDto,
    )) {
      for (const client of chunk) {
        await this.pushQueue.add('send-push-message', { pushId: id, clientId: client.id });
      }
    }

    return updated;
  }

  async cancel(id: string, projectId: string): Promise<Push> {
    const push = await this.findOne(id, projectId);
    this.assertEditable(push);
    return this.prisma.push.update({ where: { id }, data: { status: PushStatus.FAILED } });
  }

  async findLogs(id: string, projectId: string, page = 1, limit = 50) {
    await this.findOne(id, projectId);

    const [items, total] = await Promise.all([
      this.prisma.pushLog.findMany({
        where: { pushId: id },
        include: { client: { select: { id: true, tgUsername: true, tgFirstName: true } } },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.pushLog.count({ where: { pushId: id } }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // Smart Push Timing (Фаза 3.4, запрос пользователя 2026-07-15) — в какой час пуши дают
  // лучший CTR. Только пуши с непустыми buttons участвуют (jsonb_array_length > 0) — у пушей
  // без кнопок clickedAt физически не может быть проставлен (Telegram не сообщает об открытии
  // сообщения без кнопки), их включение только разбавило бы CTR нулями и не участвует.
  //
  // jsonb_typeof(...) = 'array', а не просто "buttons IS NOT NULL" — некоторые Push хранят
  // JSON-литерал null (jsonb-значение 'null', не SQL NULL, например после явной очистки поля),
  // на котором "IS NOT NULL" истинно, но jsonb_array_length падает с "cannot get array length
  // of a scalar" (поймано живым смоук-тестом при проверке этой фичи). Условие обёрнуто в CASE,
  // а не просто "typeof = 'array' AND jsonb_array_length(...) > 0" — Postgres НЕ гарантирует
  // порядок вычисления операндов AND (планировщик волен переставить их), так что без CASE
  // jsonb_array_length всё равно может быть вычислен раньше проверки типа на той же строке
  // (воспроизведено живьём: с плоским AND ошибка сохранялась даже после добавления typeof-проверки).
  async getBestTimeStats(projectId: string) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true } });
    // 'pl' — обе "PushLog" и "Push" ниже несут колонку sentAt, без алиаса Postgres бросает
    // "column reference is ambiguous" (живой 500 на этой странице, найден 2026-07-19).
    const hourBucket = hourBucketSql('sentAt', project.timezone, 'pl');

    const rows = await this.prisma.$queryRaw<{ hour: number; sent: number; clicked: number }[]>`
      SELECT ${hourBucket} as hour, COUNT(*)::int as sent, COUNT(pl."clickedAt")::int as clicked
      FROM "PushLog" pl
      JOIN "Push" p ON p.id = pl."pushId"
      WHERE p."projectId" = ${projectId} AND pl."sentAt" IS NOT NULL
        AND CASE WHEN jsonb_typeof(p."buttons") = 'array' THEN jsonb_array_length(p."buttons") > 0 ELSE false END
      GROUP BY hour
      ORDER BY hour ASC
    `;

    // Внутренний порог — не показываем рекомендацию по шуму в 1-2 отправки в час.
    const MIN_SENT_FOR_RECOMMENDATION = 5;
    const byHour = rows.map((r) => ({ hour: r.hour, sent: r.sent, clicked: r.clicked, ctr: r.sent > 0 ? r.clicked / r.sent : 0 }));
    const eligible = byHour.filter((r) => r.sent >= MIN_SENT_FOR_RECOMMENDATION);
    const best = eligible.length ? eligible.reduce((a, b) => (b.ctr > a.ctr ? b : a)) : null;

    return {
      byHour,
      recommendedHour: best?.hour ?? null,
      totalSent: byHour.reduce((s, r) => s + r.sent, 0),
      totalClicked: byHour.reduce((s, r) => s + r.clicked, 0),
    };
  }

  // Раз в сутки, не на каждую компанию по отдельному таймеру — "скользящие 30 дней
  // от последнего сброса", не календарный месяц: проще и без эффектов часового пояса
  async resetMonthlyPushLimits(): Promise<void> {
    const companies = await this.prisma.company.findMany({
      where: { pushesResetAt: { lte: subDays(new Date(), 30) } },
    });

    for (const company of companies) {
      await this.prisma.company.update({
        where: { id: company.id },
        data: { pushesThisMonth: 0, pushesResetAt: new Date() },
      });
    }
  }

  private assertEditable(push: Push) {
    if (!EDITABLE_STATUSES.includes(push.status)) {
      throw new ForbiddenException('Пуш уже отправляется или отправлен');
    }
  }
}
