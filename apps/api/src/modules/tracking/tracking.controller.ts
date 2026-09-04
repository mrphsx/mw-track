import { createHmac } from 'crypto';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ModuleRef } from '@nestjs/core';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ProjectsService } from '../projects/projects.service';
import { TrackingService } from './tracking.service';
import { TrackEventDto } from './dto/track-event.dto';
import { buildTelegramHttpsLink, buildTelegramLink } from '../channels/telegram-link.util';
import { TelegramProvider } from '../channels/providers/telegram.provider';

const REPLAY_WINDOW_MS = 5 * 60 * 1000;

@Controller('track')
export class TrackingController {
  private readonly logger = new Logger(TrackingController.name);

  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
    private trackingService: TrackingService,
    private redis: RedisService,
    // TelegramProvider резолвится лениво через ModuleRef, не конструкторной инъекцией —
    // TrackingModule намеренно не импортирует ChannelsModule (ChannelsModule уже импортирует
    // TrackingModule, прямой импорт назад замкнул бы цикл в графе DI до старта приложения) — тот
    // же приём, что уже используется в BotScenarioEngineService для того же класса проблемы (см.
    // память про circular-DI).
    private moduleRef: ModuleRef,
  ) {}

  // Браузерный SDK (track.js на лендинге) — публичный токен в URL, без подписи
  @Public()
  @Post(':publicToken/event')
  async trackEvent(
    @Param('publicToken') publicToken: string,
    @Body() dto: TrackEventDto,
    @Req() req: Request,
    @Headers('origin') origin?: string,
  ) {
    const project = await this.projectsService.findByPublicToken(publicToken);
    if (!project) throw new NotFoundException('Project not found');

    if (project.allowedDomains.length > 0 && origin) {
      const originHost = new URL(origin).hostname;
      if (!project.allowedDomains.includes(originHost)) {
        throw new ForbiddenException('Domain not allowed');
      }
    }

    return this.trackingService.recordEvent(project.id, {
      ...dto,
      ipAddress: this.getClientIp(req),
      userAgent: req.headers['user-agent'],
      source: 'BROWSER',
    });
  }

  // Серверный SDK (@trafficcrm/sdk) — secretKey + HMAC, без cookie/CORS
  @Public()
  @Post('server/:projectId/event')
  async trackServerEvent(
    @Param('projectId') projectId: string,
    @Body() dto: TrackEventDto,
    @Headers('x-signature') signature: string,
    @Headers('x-timestamp') timestamp: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const project = await this.projectsService.findById(projectId);
    // Явное сообщение (запрос пользователя 2026-09-03: "для сервера и для публичного скрипта
    // стоят разные id проекта... не работает, показывает project not found") — самая частая
    // причина этой ошибки здесь конкретно: сюда по ошибке подставили Public Token (для
    // браузерного /track/:publicToken/event) вместо Project ID (см. вкладку "Интеграция" —
    // отдельное поле рядом с Public Token/Secret Key).
    if (!project) throw new NotFoundException('Проект не найден — проверьте Project ID (не Public Token) во вкладке "Интеграция"');

    if (!signature || !timestamp || !req.rawBody) {
      throw new UnauthorizedException('Missing signature');
    }

    // Подпись считается от ИСХОДНЫХ байт тела запроса (req.rawBody), а не от
    // JSON.stringify(dto) — после ValidationPipe/class-transformer это уже другая
    // строка (порядок ключей, типы), и подпись клиента никогда бы не совпала.
    const expectedSig = createHmac('sha256', project.secretKey)
      .update(`${timestamp}.${req.rawBody.toString('utf8')}`)
      .digest('hex');

    if (signature !== `sha256=${expectedSig}`) {
      throw new UnauthorizedException('Invalid signature');
    }

    if (Date.now() - Number(timestamp) > REPLAY_WINDOW_MS) {
      throw new UnauthorizedException('Request expired');
    }

    return this.trackingService.recordEvent(project.id, { ...dto, source: 'SDK' });
  }

  // Кнопка лендинга ведёт СЮДА (302 на tg://...), а не напрямую на tg:// — многие ин-апп
  // браузеры рекламных сетей (Facebook/Instagram/TikTok WebView) блокируют переход на
  // кастомную схему прямо из <a href>, но нормально проходят через https-редирект на нашем
  // домене (запрос пользователя 2026-07-02). code — тот же одноразовый Redis start:<код>,
  // который LandingRendererService.injectTrackingScripts кладёт в Redis при рендере страницы
  // (fbclid/ttclid/utm) и который TelegramProvider.handleStart читает и удаляет при заходе
  // в бота — просто донесённый сюда через query, а не через отдельный POST + JS-перехват
  // клика, как раньше.
  @Public()
  @Get(':publicToken/tg-redirect')
  async tgRedirect(
    @Param('publicToken') publicToken: string,
    @Query('code') code: string | undefined,
    @Query('landingId') landingId: string | undefined,
    // fbp (запрос пользователя 2026-07-29, сверка с реальным примером конкурента) — _fbp cookie
    // ставится клиентским fbevents.js уже ПОСЛЕ рендера страницы, поэтому LandingRendererService
    // не может знать его в момент записи start:<code>/landing-visit-attribution в Redis. SDK
    // (apps/sdk/src/browser.ts) читает cookie в момент клика по кнопке Telegram и добавляет сюда
    // — донашиваем его в уже существующие блоки атрибуции задним числом, тем же путём, что и
    // fbclid/ip/userAgent.
    @Query('fbp') fbp: string | undefined,
    // ?format=json (запрос пользователя 2026-08-31, "возьмём у конкурента полезные наработки")
    // — их SDK предзагружает готовую ссылку заранее (по детекту TikTok-webview), а не ждёт
    // сетевой round-trip в момент самого тапа "Открыть". Тот же эндпоинт, та же атрибуция/
    // одноразовая invite-ссылка, что и у обычного 302-варианта ниже — просто отдаём готовый
    // результат телом ответа вместо самого редиректа, чтобы SDK мог собрать intent на клиенте.
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    // code — одноразовый (см. комментарий выше), поэтому ответ никогда не должен оседать в
    // каком-либо кэше (в частности — на edge у Cloudflare, теперь стоящего перед отдельным
    // redirect-доменом, запрос пользователя 2026-07-20): закэшированный 302 отдавал бы ВСЕМ
    // следующим посетителям чужую атрибуцию/устаревший инвайт вместо честного редиректа.
    res.set('Cache-Control', 'no-store');

    if (fbp) {
      await Promise.all([
        code ? this.patchCachedAttribution(`start:${code}`, { fbp }) : Promise.resolve(),
        // landing-visit-attribution:<landingId> стал FIFO-очередью, не одиночным значением
        // (см. LandingRendererService.injectTrackingScripts, баг-репорт 2026-08-19) — донашиваем
        // fbp в её ПОСЛЕДНИЙ элемент (patchCachedListTail), не GET/SET одного ключа.
        landingId ? this.patchCachedListTail(`landing-visit-attribution:${landingId}`, { fbp }) : Promise.resolve(),
      ]);
    }

    const project = await this.projectsService.findByPublicToken(publicToken);

    // Персональная invite-ссылка лендинга (Landing.tgInviteLink) — для точной
    // пер-лендинговой атрибуции (TelegramProvider.handleJoinRequest). Если лендинг ещё не
    // публиковался с этой фичи (ссылка не создана), buildTelegramLink сама откатится на
    // общую ссылку канала.
    const landing = landingId ? await this.prisma.landing.findUnique({ where: { id: landingId }, select: { tgInviteLink: true } }) : null;

    // Персональная invite-ссылка НА ЭТОТ ВИЗИТ (запрос пользователя 2026-08-31: "у конкурентов
    // под каждого подписчика своя invite-ссылка, это решает проблему с очередью") — заменяет
    // общую ссылку лендинга, когда получилось её создать: TelegramProvider.handleJoinRequest
    // тогда находит атрибуцию ТОЧНЫМ совпадением по ссылке, без всякой FIFO/lookahead-очереди.
    // Только PRIVATE_CHANNEL_REQUEST (другие режимы уже несут атрибуцию через code/&start=
    // напрямую, invite-ссылка у них не используется вообще) и только когда есть code — без него
    // неоткуда взять уже готовую атрибуцию визита. Любая проблема (нет start:<code>, канал не
    // инициализирован, ошибка Bot API) — просто не выставляем landingInviteLink, дальше работает
    // прежний путь (общая ссылка + очередь), тот же fallback, что и до этой фичи.
    let landingInviteLink = landing?.tgInviteLink ?? undefined;
    if (code && project?.channel?.type === 'TELEGRAM' && project.channel.tgMode === 'PRIVATE_CHANNEL_REQUEST') {
      const cachedRaw = await this.redis.get(`start:${code}`);
      if (cachedRaw) {
        try {
          const cachedAttribution = JSON.parse(cachedRaw);
          const telegramProvider = this.moduleRef.get(TelegramProvider, { strict: false });
          const oneTimeLink = await telegramProvider.createOneTimeInviteLink(project.channel, {
            ...cachedAttribution,
            landingId: landingId ?? null,
          });
          if (oneTimeLink) landingInviteLink = oneTimeLink;
        } catch (error) {
          this.logger.warn(`Одноразовая invite-ссылка не создана, откат на общую: ${(error as Error).message}`);
        }
      }
    }

    const tgUrl = buildTelegramLink(project?.channel ?? null, code, landingInviteLink);

    if (!tgUrl) {
      if (format === 'json') {
        res.status(404).json({ tg: null, https: null });
        return;
      }
      res.status(404).send('<h1>Канал не найден</h1>');
      return;
    }

    if (format === 'json') {
      const httpsUrl = buildTelegramHttpsLink(project?.channel ?? null, code, landingInviteLink);
      res.json({ tg: tgUrl, https: httpsUrl || null });
      return;
    }

    res.redirect(302, tgUrl);
  }

  // Smart Push Timing (Фаза 3.4, запрос пользователя 2026-07-15) — первый клик-трекинг в
  // проекте. Кнопки пушей при отправке подменяются на этот редирект (pushes.processor.ts),
  // url — исходная ссылка, которую баер указал в кнопке. Первый клик на конкретное отправление
  // засчитывается один раз (PushLog.clickedAt), повторные клики того же получателя CTR не
  // раздувают. Лог не найден — всё равно редиректим, чтобы не сломать кнопку пользователю,
  // просто не считаем клик.
  @Public()
  @Get('push/:pushLogId')
  async pushClickRedirect(@Param('pushLogId') pushLogId: string, @Query('url') url: string | undefined, @Res() res: Response) {
    if (!url || !/^https?:\/\//i.test(url)) {
      res.status(400).send('Invalid redirect URL');
      return;
    }

    const log = await this.prisma.pushLog.findUnique({ where: { id: pushLogId } });
    if (log && !log.clickedAt) {
      await this.prisma.pushLog.update({ where: { id: pushLogId }, data: { clickedAt: new Date() } });
    }

    res.redirect(302, url);
  }

  // Донашивает поля (сейчас — только fbp) в уже существующий JSON-блок атрибуции в Redis,
  // не трогая TTL (KEEPTTL) и не создавая ключ, если его ещё нет (запись без остальной
  // атрибуции рядом бесполезна — просто ключ не найден, тихо ничего не делаем).
  private async patchCachedAttribution(key: string, patch: Record<string, string>): Promise<void> {
    const raw = await this.redis.get(key);
    if (!raw) return;
    try {
      const merged = { ...JSON.parse(raw), ...patch };
      await this.redis.set(key, JSON.stringify(merged), 'KEEPTTL');
    } catch {
      // битый JSON в кэше — не должно ронять сам редирект
    }
  }

  // Та же донашиваемая fbp-патч-логика, что и patchCachedAttribution выше, но для ключа-СПИСКА
  // (landing-visit-attribution:<landingId> — FIFO-очередь визитов, см. комментарий у вызова).
  // Патчим ПОСЛЕДНИЙ элемент (LINDEX/LSET по индексу -1), не первый: RPUSH кладёt новые визиты в
  // конец, а этот редирект случается почти сразу после того, как ТЕКУЩИЙ визитор сам же
  // дописал свою запись — она и есть последняя на момент клика (если только кто-то другой не
  // успел зайти на тот же лендинг в те же секунды между рендером страницы и кликом по кнопке —
  // узкое окно гонки по сравнению с прежним 30-минутным, и fbp — второстепенное поле, не buyerId).
  private async patchCachedListTail(key: string, patch: Record<string, string>): Promise<void> {
    let raw: string | null;
    try {
      raw = await this.redis.lindex(key, -1);
    } catch (error) {
      // Переходный период сразу после деплоя (см. rpushSelfHealing в LandingRendererService) —
      // ключ ещё может быть старой строкой (SET), LINDEX на неё бросает WRONGTYPE. Это самый
      // горячий путь (редирект по клику каждого реального посетителя) — обязательно не ронять
      // его; следующий RPUSH сам подчистит ключ.
      return;
    }
    if (!raw) return;
    try {
      const merged = { ...JSON.parse(raw), ...patch };
      await this.redis.lset(key, -1, JSON.stringify(merged));
    } catch {
      // битый JSON в кэше, либо список успел опустеть между LINDEX и LSET — не должно ронять редирект
    }
  }

  private getClientIp(req: Request): string {
    return (
      (req.headers['cf-connecting-ip'] as string) ||
      (req.headers['x-real-ip'] as string) ||
      req.headers['x-forwarded-for']?.toString().split(',')[0] ||
      req.socket.remoteAddress ||
      ''
    );
  }
}
