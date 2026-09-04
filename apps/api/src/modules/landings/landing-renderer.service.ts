import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as geoip from 'geoip-lite';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Landing, Project, TrackingPixel } from '@prisma/client';
import { Request, Response } from 'express';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { StorageService } from './storage.service';
import { matchDomainPath } from '../domains/domain-path.util';
import { TelegramLinkChannel, buildTelegramLink } from '../channels/telegram-link.util';
import { invertParamMap, resolveParamMap } from '../tracking/link-params.const';
import { resolveBuyerShortCode, resolvePixelShortCode } from '../../common/short-code.util';
import { isBotUserAgent } from '../../common/bot-user-agent.util';

// Хэш содержимого track.js (см. apps/sdk/scripts/publish-cdn.js — перезаписывается на каждом
// SDK-паблише, попадает в dist через nest-cli.json assets). Добавляется в URL скрипта как
// ?v=<hash>, чтобы Cloudflare/браузерный Cache-Control:max-age=14400 не отдавал старую версию
// после SDK-фикса — без версии в ссылке 2026-08-25 4-часовой кэш маскировал уже выкаченный фикс
// TikTok-подсказки под видом "не работает". Если файл почему-то отсутствует (например, до
// первого запуска publish-cdn.js в свежем окружении), просто не версионируем ссылку — не должно
// ронять рендер лендинга.
let sdkVersionHash = '';
try {
  sdkVersionHash = (JSON.parse(fsSync.readFileSync(path.join(__dirname, 'sdk-version.json'), 'utf-8')) as { hash: string }).hash;
} catch {
  // см. комментарий выше
}

const START_CODE_TTL_SECONDS = 24 * 60 * 60;
// TTL кэша "последний визит на лендинг" (landing-visit-country/landing-visit-attribution) —
// баг-репорт пользователя 2026-07-24 (клиент PERRIDOL): реальный разрыв между загрузкой
// страницы лендинга и фактическим вступлением в приватный канал может быть больше 5 минут
// (вкладка лендинга осталась открытой, вступление произошло по уже загруженной странице без
// перезагрузки) — кэш успевал истечь, и Client создавался вообще без атрибуции. Поднято с 300
// до 1800 секунд (компромисс: не 24 часа, как у start:<code> — ключ общий на весь лендинг, а не
// привязан к конкретному посетителю, поэтому слишком долгий TTL повышает риск, что атрибуция
// ОДНОГО посетителя пришьётся к вступлению СОВСЕМ ДРУГОГО человека, зашедшего на тот же лендинг
// с другой рекламы в пределах TTL).
const LANDING_VISIT_TTL_SECONDS = 30 * 60;

// Баг-репорт пользователя 2026-07-29: "наши events не попадают в фейсбук" — реальная причина
// (не отсутствие полей, а испорченные данные): Facebook САМ сканирует ссылку на лендинг
// краулером-препросмотрщиком (facebookexternalhit) почти на каждый показ/клик объявления —
// его визит попадал в тот же landing-visit-country/landing-visit-attribution:<landingId> кэш
// (общий на весь лендинг, "последний визит побеждает" — осознанное упрощение, см. комментарий
// у LANDING_VISIT_TTL_SECONDS), и почти всегда оказывался ПОСЛЕДНИМ перед реальным вступлением
// в приватный канал: живые Subscribe/Dialogue массово уходили в Facebook с IP/User-Agent самого
// Facebook (2a03:2880::/32, "facebookexternalhit/1.1...") вместо настоящего посетителя, без
// fbclid/fbp вообще (краулер не кликает по рекламе и не выполняет JS) — набор данных, который
// сам Facebook не может сопоставить ни с одним реальным пользователем. isBotUserAgent — вынесена
// в common/bot-user-agent.util.ts (запрос пользователя 2026-08-31), нужна теперь и в
// TrackingService.

// Facebook/TikTok иногда подставляют значение динамического макроса ({{campaign.name}} и т.п.)
// уже percent-encoded (баг-репорт пользователя 2026-07-25: "кампанию... показывает так
// scm%7Ccr%7Cvd1%7Cspez1" — реальное имя кампании со знаком "|", закодированным как %7C) —
// Express (`qs`) уже сделал ОДИН проход декодирования при разборе query-строки в req.query, но
// если после этого в значении всё ещё остался паттерн %XX — значит исходно было закодировано
// ДВАЖДЫ, декодируем ещё раз. Для уже нормальных значений (без %XX) — no-op. Тот же приём, что
// и в apps/sdk/src/browser.ts (SDK получает то же самое от Facebook на клике, до сервера).
//
// Иногда рекламная площадка вообще НЕ подставляет часть макросов в конкретной доставке (баг-
// репорт пользователя 2026-08-20: campaign_id/campaign_name/adset_id/adset_name пришли
// буквально нерасшифрованными "{{campaign.id}}" и т.п., хотя ad_id/ad_name ДО них и placement/
// site_source_name ПОСЛЕ них в той же ссылке подставились нормально — не обрезка URL (итоговая
// строка оказалась КОРОЧЕ рабочих примеров того же объявления), а сбой на стороне площадки при
// разрешении иерархии объявление→группа→кампания, вне нашего контроля). Раньше такое буквальное
// значение сохранялось как будто это настоящие данные, засоряя карточку клиента и разбивку по
// кампаниям фейковой строкой "{{campaign.id}}" — теперь считается отсутствием значения (null),
// как и подобает несостоявшейся подстановке, а не настоящим значением "campaign.id".
//
// Отдельный случай, найденный пользователем в том же баг-репорте: НАСТОЯЩАЯ обрезка URL может
// оборвать макрос ПОСЕРЕДИНЕ, оставив "{{site_source_name" без закрывающих "}}" — такое значение
// не матчится полным "^\{\{.*\}\}$" (нет закрывающей части вообще), поэтому раньше проходило бы
// как "настоящее" значение. Проверка теперь по ПОДСТРОКЕ, не по полному совпадению: любое
// вхождение "{{"/"}}" где угодно в значении (реальное название кампании/объявления никогда не
// содержит двойных фигурных скобок) или значение, начинающееся с двойного подчёркивания и
// заглавной буквы (TikTok-макрос "__ИМЯ__", тот же довод — обрублен он или цел целиком) считается
// испорченным/несостоявшимся макросом, а не настоящими данными.
const UNSUBSTITUTED_MACRO_PATTERN = /\{\{|\}\}|^__[A-Z]/;

function decodeAdMacro(value: string | null): string | null {
  if (!value) return value;
  let decoded = value;
  if (/%[0-9A-Fa-f]{2}/.test(decoded)) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // decodeURIComponent бросает на оборванной %-последовательности — это сама по себе
      // улика обрезки URL (баг-репорт 2026-08-31: "adName" оборван на "...%" без хвоста),
      // то же "не настоящее значение", что и {{...}}/__..., поэтому null, а не сырой мусор.
      return null;
    }
  }
  return UNSUBSTITUTED_MACRO_PATTERN.test(decoded) ? null : decoded;
}

// Клоакинг без явно заданной cloakingRedirectUrl — куда отправлять посетителей из
// не-разрешённых стран по умолчанию (запрос пользователя 2026-07-03, пример "например
// википедия").
const DEFAULT_CLOAK_REDIRECT_URL = 'https://en.wikipedia.org';

type ProjectWithLandingData = Project & {
  // tgAvatarFileId — не часть TelegramLinkChannel (тот только для buildTelegramLink), нужен
  // отдельно здесь для дефолтной аватарки лендинга ("изначально как в канале", см.
  // renderTemplate) — лишнее поле не мешает структурной совместимости с TelegramLinkChannel.
  channel: (TelegramLinkChannel & { tgAvatarFileId: string | null }) | null;
  pixels: TrackingPixel[]; // проект не привязан к платформе — пикселей любых платформ может быть несколько
};

@Injectable()
export class LandingRendererService {
  private readonly logger = new Logger(LandingRendererService.name);
  private readonly templatesDir = path.join(__dirname, 'templates');

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private storage: StorageService,
  ) {}

  // Один домен -> много лендингов/проектов через путь (2026-06-29, DomainPath) — вызывается
  // из InternalController.serveByDomain на КАЖДЫЙ запрос к клиентскому домену (Nginx больше не
  // знает про лендинги, см. NginxService.renderTarget). fullPath — полный путь запроса с
  // ведущим "/", без query string. Голый домен без явного маппинга пути (включая "/") отдаёт
  // 404 — раньше Domain.landingId неявно отдавал контент на корне для любого домена.
  async renderByDomain(host: string, fullPath: string, req: Request, res: Response): Promise<void> {
    const bareHost = host.replace(/^www\./, '').toLowerCase();
    const domain = await this.prisma.domain.findFirst({ where: { domain: bareHost, status: 'ACTIVE', deletedAt: null } });
    if (!domain) {
      res.status(404).send('<h1>Page not found</h1>');
      return;
    }

    const paths = await this.prisma.domainPath.findMany({ where: { domainId: domain.id } });
    const resolved = matchDomainPath(paths, fullPath);
    if (!resolved) {
      res.status(404).send('<h1>Page not found</h1>');
      return;
    }

    // Ровно одно из двух (запрос пользователя 2026-07-17) — путь либо на конкретный лендинг
    // (рендерится строго он, БЕЗ сплита, даже если он параллельно состоит в группе через
    // другую ссылку), либо сразу на группу (сплит применяется всегда). Раньше сплит был
    // неявным свойством самого лендинга — теперь явное свойство конкретной ссылки.
    const landingId = resolved.landingId ?? (await this.pickAbTestGroupVariant(resolved.abTestGroupId!));
    if (!landingId) {
      res.status(404).send('<h1>Page not found</h1>');
      return;
    }

    // abTestGroupId передаётся дальше ТОЛЬКО когда путь ведёт на саму группу (resolved.landingId
    // отсутствует) — запрос пользователя 2026-08-20: "не нужно в ней учитывать статистику
    // каждого лэндинга по отдельности, даже если эти лэндинги проливаются отдельно... группа
    // как отдельная сущность со своей статой разделенной". Раньше группа-статистика считалась
    // по Landing.abTestGroupId (ТЕКУЩЕЕ членство) + отсечке по времени — это ошибочно приплюсовывало
    // ЛЮБОЙ трафик на лендинг-участника (включая его собственную отдельную рекламу через прямую
    // ссылку на тот же лендинг) к тесту. Явный флаг "этот конкретный заход пришёл через сплит
    // группы" передаётся дальше в injectTrackingScripts и стемпится на Client/TrackingEvent —
    // так группа считает строго свой собственный трафик, независимо от того, что происходит с
    // лендингом-участником по его прямым ссылкам.
    await this.renderAndServe(landingId, resolved.subPath, req, res, resolved.landingId ? undefined : resolved.abTestGroupId);
  }

  // A/B/n-тестирование (Фаза 3.2, запрос пользователя 2026-07-15, расширено с пары до
  // произвольного числа вариантов с индивидуальными процентами) — случайный взвешенный сплит
  // на каждый заход, без cookie/стикости (осознанно, согласовано с пользователем: в кодовой
  // базе нет cookie-инфраструктуры, посетитель может попасть на другой вариант при повторном
  // визите — принятый компромисс ради простоты v1).
  private async pickAbTestGroupVariant(groupId: string): Promise<string | null> {
    const members = await this.prisma.landing.findMany({
      where: { abTestGroupId: groupId, deletedAt: null },
      select: { id: true, abTestWeight: true },
    });
    // Группа выродилась в 0 живых участников — страница 404, как и при отсутствии пути вообще.
    if (members.length === 0) return null;
    // Один живой участник — рендерим его напрямую, без броска монетки.
    if (members.length === 1) return members[0].id;

    const totalWeight = members.reduce((sum, m) => sum + (m.abTestWeight ?? 0), 0) || members.length;
    let roll = Math.random() * totalWeight;
    for (const m of members) {
      roll -= m.abTestWeight ?? totalWeight / members.length;
      if (roll <= 0) return m.id;
    }
    return members[members.length - 1].id;
  }

  // subPath — запрошенный путь внутри лендинга после landingId (см. InternalController):
  // '' для корня (index.html у CUSTOM), 'style.css'/'img/logo.png' и т.п. для остальных
  // ассетов CUSTOM-лендинга. Для TEMPLATE игнорируется — там всегда одна страница.
  // abTestGroupId — см. комментарий у вызова в renderByDomain: задан только когда этот
  // конкретный заход пришёл через сплит A/B/n-группы, а не напрямую на лендинг.
  async renderAndServe(landingId: string, subPath: string, req: Request, res: Response, abTestGroupId?: string): Promise<void> {
    const landing = await this.prisma.landing.findUnique({
      where: { id: landingId },
      include: {
        project: {
          include: {
            // 1:1 с 2026-07-02 — канал проекта может быть любого типа (не только Telegram),
            // buildTelegramLink ниже сам проверяет channel.type перед сборкой deep-link.
            channel: {
              select: { type: true, tgMode: true, tgBotUsername: true, tgChannelUsername: true, tgPersonalUsername: true, tgInviteLink: true, tgAvatarFileId: true, websiteUrl: true },
            },
            pixels: { where: { isActive: true } },
          },
        },
      },
    });

    if (!landing || landing.status !== 'PUBLISHED' || landing.deletedAt) {
      res.status(404).send('<h1>Page not found</h1>');
      return;
    }

    // Клоакинг — до любого рендера контента: посетитель не из разрешённой страны никогда
    // не должен получить реальный HTML лендинга, даже на подресурсы (style.css/картинки —
    // сюда же попадают через тот же renderAndServe с непустым subPath, см. renderByDomain).
    if (landing.cloakingEnabled && !this.isCountryAllowed(req, landing.cloakingCountries)) {
      res.redirect(302, landing.cloakingRedirectUrl || DEFAULT_CLOAK_REDIRECT_URL);
      return;
    }

    if (landing.type === 'CUSTOM') {
      await this.serveCustomFile(landing as Landing & { project: ProjectWithLandingData }, subPath, req, res, abTestGroupId);
      return;
    }

    // EXTERNAL (внешний сервер клиента) — отдельный шаг 2.4, не реализуется здесь.
    if (landing.type !== 'TEMPLATE') {
      res.status(404).send('<h1>Landing type not supported yet</h1>');
      return;
    }

    let html = await this.renderTemplate(landing as Landing & { project: ProjectWithLandingData });
    html = await this.injectTrackingScripts(html, landing.project, req, landing as Landing, abTestGroupId);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    this.removeRestrictiveCsp(res);
    res.send(html);
  }

  // helmet() в main.ts ставит на КАЖДЫЙ ответ api default CSP (script-src 'self') —
  // разумно для своих JSON-эндпоинтов, но лендинги по дизайну грузят сторонние скрипты
  // с другого origin (CDN_URL — apps/sdk/track.js, плюс FB/TikTok pixel, Cloudflare beacon
  // и т.п. у клиентов) — 'self' блокирует их все молча (ошибка видна только в консоли
  // браузера посетителя). У публичных лендингов нет sessions/cookies этого API, которые
  // CSP защищала бы — снимаем заголовок только здесь, не трогая остальной API.
  private removeRestrictiveCsp(res: Response): void {
    res.removeHeader('Content-Security-Policy');
  }

  // Отдаёт index.html (с инжектом трекинга) либо произвольный ассет CUSTOM-лендинга из MinIO.
  private async serveCustomFile(
    landing: Landing & { project: ProjectWithLandingData },
    subPath: string,
    req: Request,
    res: Response,
    abTestGroupId?: string,
  ): Promise<void> {
    const isIndex = !subPath || subPath === 'index.html';
    const key = `${landing.customBasePath}/${isIndex ? 'index.html' : subPath}`;

    try {
      if (isIndex) {
        const buffer = await this.storage.getObjectBuffer(key);
        const html = await this.injectTrackingScripts(buffer.toString('utf-8'), landing.project, req, landing, abTestGroupId);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store');
        this.removeRestrictiveCsp(res);
        res.send(html);
        return;
      }

      const stream = await this.storage.getObjectStream(key);
      res.type(path.extname(key) || '.bin');
      stream.on('error', () => {
        if (!res.headersSent) res.status(404).send('Not found');
      });
      stream.pipe(res);
    } catch (error) {
      this.logger.warn(`serveCustomFile failed for ${key}: ${(error as Error).message}`);
      res.status(404).send(isIndex ? '<h1>Page not found</h1>' : 'Not found');
    }
  }

  async renderPreviewHtml(landingId: string, companyId: string): Promise<string> {
    const landing = await this.prisma.landing.findFirst({
      where: { id: landingId, companyId, deletedAt: null },
      include: {
        project: {
          include: {
            // 1:1 с 2026-07-02 — канал проекта может быть любого типа (не только Telegram),
            // buildTelegramLink ниже сам проверяет channel.type перед сборкой deep-link.
            channel: {
              select: { type: true, tgMode: true, tgBotUsername: true, tgChannelUsername: true, tgPersonalUsername: true, tgInviteLink: true, tgAvatarFileId: true, websiteUrl: true },
            },
            pixels: { where: { isActive: true } },
          },
        },
      },
    });
    if (!landing) throw new NotFoundException('Лендинг не найден');

    if (landing.type === 'CUSTOM') {
      if (!landing.customBasePath) throw new NotFoundException('Лендинг ещё не загружен');
      const buffer = await this.storage.getObjectBuffer(`${landing.customBasePath}/index.html`);
      return buffer.toString('utf-8');
    }

    if (landing.type !== 'TEMPLATE') throw new NotFoundException('Предпросмотр пока не поддержан для этого типа лендинга');

    return this.renderTemplate(landing as Landing & { project: ProjectWithLandingData });
  }

  // Мини-превью шаблона со статичными демо-данными (запрос пользователя 2026-07-15) — не
  // привязано ни к какому реальному лендингу/проекту, просто рендерит template.html с
  // заглушками, чтобы показать карточками "как это будет выглядеть" при выборе шаблона в
  // диалоге создания. templateId приходит из query/params — валидируем формат явно (только
  // буквы/цифры/дефис), иначе он подставился бы прямо в fs-путь ниже (path traversal).
  async renderTemplateGalleryPreview(templateId: string): Promise<string> {
    if (!/^[a-z0-9-]+$/.test(templateId)) throw new NotFoundException('Шаблон не найден');

    const templatePath = path.join(this.templatesDir, templateId, 'template.html');
    let html: string;
    try {
      html = this.stripStyleComments(await fs.readFile(templatePath, 'utf-8'));
    } catch {
      throw new NotFoundException('Шаблон не найден');
    }

    const vars: Record<string, string> = {
      META_TITLE: 'Название канала',
      META_DESCRIPTION: 'Описание канала',
      CHANNEL_TITLE: 'Название канала',
      CHANNEL_DESCRIPTION: 'Присоединяйтесь к нашему каналу — здесь только полезный контент и никакого спама.',
      CHANNEL_AVATAR: '',
      CHANNEL_INITIAL: 'К',
      SUBSCRIBERS_COUNT: '12 480',
      SUBSCRIBERS_LABEL: 'подписчиков',
      JOIN_BUTTON_TEXT: 'Вступить в канал',
      TG_REDIRECT_URL: '#',
      START_CODE: '',
      PRIMARY_COLOR: '#2AABEE',
      BG_COLOR: '#f0f4f8',
      GRADIENT_FROM: '#667eea',
      GRADIENT_TO: '#764ba2',
      CDN_URL: process.env.CDN_URL || '',
      // age-gate-invite (запрос пользователя 2026-08-18) — без этих ключей все поля
      // попапов рендерились бы пустыми в живом превью галереи шаблонов (renderTemplate/
      // replaceAll заменяет отсутствующий {{KEY}} на '').
      POPUP1_TITLE: '¿Tienes más de 18 años?',
      POPUP1_TEXT: 'Debes tener 18 años para continuar',
      POPUP1_YES_TEXT: 'Sí',
      POPUP1_NO_TEXT: 'No',
      POPUP2_TITLE: '¡Suscríbete a nuestro canal!',
      POPUP2_TEXT: '',
      POPUP2_BUTTON_TEXT: 'Unirse al canal',
    };

    html = this.processConditionals(html, vars);
    for (const [key, value] of Object.entries(vars)) {
      html = html.replaceAll(`{{${key}}}`, value || '');
    }

    return html;
  }

  private async renderTemplate(landing: Landing & { project: ProjectWithLandingData }): Promise<string> {
    const templatePath = path.join(this.templatesDir, landing.templateId!, 'template.html');
    let html = this.stripStyleComments(await fs.readFile(templatePath, 'utf-8'));

    const data = (landing.templateData as Record<string, string>) || {};

    // Кнопка ведёт не напрямую на tg://, а на собственный редирект-эндпоинт
    // (TrackingController.tgRedirect), который сам строит tg://-ссылку и отвечает 302.
    // Так надёжнее внутри ин-апп браузеров рекламных сетей (Facebook/Instagram/TikTok
    // WebView) — многие из них блокируют переход на кастомную схему прямо из <a href>,
    // но нормально проходят через https-редирект на нашем домене (запрос пользователя
    // 2026-07-02). ?code={{START_CODE}} — тот же одноразовый Redis-код с fbclid/ttclid/utm,
    // что и раньше, просто донесённый до бота через редирект, а не через SDK-перехват клика.
    const hasTelegramLink = !!buildTelegramLink(landing.project.channel);
    // Обычный сайт (ChannelType.WEBSITE, запрос пользователя 2026-09-03) — кнопка лендинга
    // ведёт прямо на сайт, а не в Telegram. websiteUrl тут не резолвится сразу в финальный
    // адрес — нужен req.query (fbclid/utm визита) для проброса на сайт, а renderTemplate() его
    // не получает (вызывается и без запроса — см. renderPreviewHtml). Резолв — в
    // injectTrackingScripts ниже, тем же приёмом, что уже применён к START_CODE.
    const hasWebsiteLink = landing.project.channel?.type === 'WEBSITE' && !!landing.project.channel?.websiteUrl;

    // Аватарка лендинга (запрос пользователя 2026-07-04): своя загруженная (Landing.avatarKey)
    // либо, если её нет, фото канала ("изначально как в канале") — оба случая отдаёт один и
    // тот же публичный эндпоинт (LandingsService.streamAvatar сам решает источник на лету).
    // data.CHANNEL_AVATAR (ручной URL из старого workflow) — фолбэк на случай лендингов,
    // созданных до этой фичи, где ничего из вышеперечисленного не задано.
    const hasOwnOrChannelAvatar = !!landing.avatarKey || !!landing.project.channel?.tgAvatarFileId;
    // ?v= — баг-фикс 2026-07-27 (запрос пользователя: "при загрузке аватарки она не
    // обновляется"): URL был статичным (всегда /landings/:id/avatar), а streamAvatar отдаёт
    // Cache-Control: max-age=86400 — после замены аватарки браузер молча показывал старую
    // картинку из кэша ещё сутки, потому что сам URL не менялся. avatarKey уже содержит
    // Date.now() в имени (см. uploadAvatar), поэтому это готовый версионирующий токен — при
    // каждой загрузке новый avatarKey → новый URL → новый кэш-слот в браузере.
    const channelAvatar = hasOwnOrChannelAvatar
      ? `${process.env.API_URL}/api/v1/landings/${landing.id}/avatar?v=${encodeURIComponent(landing.avatarKey || 'channel')}`
      : data.CHANNEL_AVATAR || '';

    const vars: Record<string, string> = {
      ...data,
      // Фолбэк для лендингов, созданных до этого поля (запрос пользователя 2026-07-21) —
      // templateData ещё не содержит SUBSCRIBERS_LABEL.
      SUBSCRIBERS_LABEL: data.SUBSCRIBERS_LABEL || 'подписчиков',
      CHANNEL_AVATAR: channelAvatar,
      META_TITLE: landing.metaTitle || data.CHANNEL_TITLE || 'Закрытый канал',
      META_DESCRIPTION: landing.metaDescription || data.CHANNEL_DESCRIPTION || '',
      // landingId — чтобы редирект-эндпоинт мог найти персональную invite-ссылку ИМЕННО
      // этого лендинга (Landing.tgInviteLink) для точной пер-лендинговой атрибуции, а не
      // только общую ссылку канала.
      // TG_REDIRECT_BASE_URL (не API_URL) — отдельный публичный домен специально под этот
      // редирект (запрос пользователя 2026-07-20, "чтобы рекламные платформы не видели ссылку
      // к телеграмму") — тот же бэкенд физически, но домен не выдаёт связь с основным
      // продуктом при автоматическом сканировании ссылки в объявлении Facebook/TikTok.
      // API_URL по-прежнему используется для всего остального на этой странице (аватар,
      // data-api-url) — трогать его нельзя, он завязан на вебхуки Telegram/WhatsApp/Heleket.
      TG_REDIRECT_URL: hasTelegramLink
        ? `${process.env.TG_REDIRECT_BASE_URL}/api/v1/track/${landing.project.publicToken}/tg-redirect?code={{START_CODE}}&landingId=${landing.id}`
        : hasWebsiteLink
          ? '{{TG_REDIRECT_URL}}' // заменяется позже, в injectTrackingScripts (нужен req.query)
          : '',
      START_CODE: '{{START_CODE}}', // заменяется позже, в injectTrackingScripts
      CHANNEL_INITIAL: (data.CHANNEL_TITLE || 'C').charAt(0).toUpperCase(),
      // Для шаблонов с собственными статическими ассетами (например tg-invite-dark/bg.svg) —
      // хостятся на том же публичном CDN-бакете, что и track.js (см.
      // apps/api/scripts/publish-template-assets.js), не на приватном StorageService-бакете.
      CDN_URL: process.env.CDN_URL || '',
    };

    html = this.processConditionals(html, vars);

    for (const [key, value] of Object.entries(vars)) {
      html = html.replaceAll(`{{${key}}}`, value || '');
    }

    return html;
  }

  // Дока обрабатывала только if-без-else, но шаблон minimal использует конструкцию с else —
  // без её поддержки фолбэк-ветка либо терялась, либо попадала в HTML как текст.
  private processConditionals(html: string, vars: Record<string, string>): string {
    return html.replace(
      /\{\{#if (\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
      (_match, varName: string, ifContent: string, elseContent = '') => (vars[varName] ? ifContent : elseContent),
    );
  }

  // Баг-репорт 2026-07-27 ("фейсбук блокирует некоторые лендинги, возможно из-за связи с
  // телеграм") — разработческие CSS-комментарии внутри <style> (объясняют вёрстку, часто на
  // русском и/или упоминают telegram.org, см. templates/telegram-*/tg-invite-*) невидимы
  // визитёру, но остаются в исходнике HTML как есть, который может просканировать краулер
  // рекламной площадки. Вырезаем их из финального рендера — на вёрстку не влияет (CSS-комментарии
  // и так не отображаются), но чистит то, что реально уходит наружу в ответе сервера.
  private stripStyleComments(html: string): string {
    return html.replace(/<style>[\s\S]*?<\/style>/g, (styleBlock) => styleBlock.replace(/\/\*[\s\S]*?\*\//g, ''));
  }

  // Обычный сайт (ChannelType.WEBSITE, запрос пользователя 2026-09-03) — прокидывает
  // fbclid/utm/рекламные макросы визита на лендинг прямо в query адреса сайта, чтобы track.js
  // на самой странице сайта подхватил их через window.location.search (тот же принцип, что
  // уже использует сам SDK). В отличие от Telegram-веток, без промежуточного редирект-
  // эндпоинта — сайт открывается напрямую, поэтому query нужно смержить здесь, а не доверять
  // отдельному прокси-хендлеру.
  private buildWebsiteDestination(channel: TelegramLinkChannel | null, urlParams: URLSearchParams): string {
    if (!channel || channel.type !== 'WEBSITE' || !channel.websiteUrl) return '';
    try {
      const dest = new URL(channel.websiteUrl);
      for (const [key, value] of urlParams.entries()) {
        dest.searchParams.set(key, value);
      }
      return dest.toString();
    } catch {
      return '';
    }
  }

  // См. комментарий у вызова (injectTrackingScripts) — переживает переходный период сразу после
  // деплоя, когда ключ landing-visit-attribution:<landingId> ещё может быть старой строкой (SET)
  // с прежнего кода, до истечения её собственного TTL.
  private async rpushSelfHealing(key: string, value: string): Promise<void> {
    try {
      await this.redis.rpush(key, value);
    } catch (error) {
      if (String(error).includes('WRONGTYPE')) {
        await this.redis.del(key);
        await this.redis.rpush(key, value);
      } else {
        throw error;
      }
    }
  }

  // abTestGroupId — задан только когда этот конкретный заход пришёл через сплит A/B/n-группы
  // (см. renderByDomain), не когда лендинг просто СОСТОИТ в группе. Стемпится дальше на
  // Client/TrackingEvent (запрос пользователя 2026-08-20) — группа считает строго свой
  // собственный трафик, отдельно от того, что происходит с лендингом-участником по его прямым
  // ссылкам/собственной рекламе.
  private async injectTrackingScripts(html: string, project: ProjectWithLandingData, req: Request, landing: Landing, abTestGroupId?: string): Promise<string> {
    const startCode = nanoid(16);

    const urlParams = new URLSearchParams(req.query as Record<string, string>);

    // Кастомные имена query-параметров ссылки (запрос пользователя 2026-07-04, "получить
    // ссылку" с пикселем + рекламными макросами) — читаем входящий URL по карте проекта,
    // не по дефолтным именам, чтобы переименование в настройках реально работало.
    const paramMap = resolveParamMap(project.linkParamMap);
    const paramLookup = invertParamMap(paramMap);
    const adMacroData: Record<string, string | null> = {};
    for (const [actualName, semanticKey] of Object.entries(paramLookup)) {
      adMacroData[semanticKey] = decodeAdMacro(urlParams.get(actualName));
    }
    // Короткие коды баера/пикселя (запрос пользователя 2026-08-20: "сократим значения z=/pixel=
    // до коротких кодов, ОБЯЗАТЕЛЬНО с обратной совместимостью для старых ссылок") — разворачиваем
    // здесь же, ДО того как значения попадут в trackingData/attribution (start:<code> Redis-кэш и
    // PRIVATE_CHANNEL_REQUEST landing-visit-attribution ниже читают их напрямую как уже готовые
    // User.id/TrackingPixel.id, без своего собственного резолвинга). Длина сама отличает старый
    // формат (полный cuid) от нового короткого кода — см. common/short-code.util.ts.
    if (adMacroData.pixelId) adMacroData.pixelId = (await resolvePixelShortCode(this.prisma, adMacroData.pixelId)) ?? null;
    if (adMacroData.buyerRef) adMacroData.buyerRef = (await resolveBuyerShortCode(this.prisma, adMacroData.buyerRef)) ?? null;

    const trackingData = {
      fbclid: urlParams.get('fbclid'),
      ttclid: urlParams.get('ttclid'),
      utmSource: urlParams.get('utm_source'),
      utmMedium: urlParams.get('utm_medium'),
      utmCampaign: decodeAdMacro(urlParams.get('utm_campaign')),
      utmContent: urlParams.get('utm_content'),
      ...adMacroData,
      ip: this.getClientIp(req),
      userAgent: req.headers['user-agent'],
      // countryCode (запрос пользователя 2026-07-29, Facebook Advanced Matching) — resolveCountry
      // уже отдаёт ISO alpha-2 (Cloudflare cf-ipcountry/geoip-lite), просто раньше нигде не
      // прокидывался дальше fbclid/ip/userAgent через тот же start:<code>-мост.
      countryCode: this.resolveCountry(req),
      landingUrl: req.url,
      // Запрос пользователя 2026-07-04 (диалоги) — для PERSONAL_DM это единственный способ
      // атрибутировать лендинг: код долетает как обычный текст первого сообщения (см.
      // buildTelegramLink &text=), TelegramPersonalService читает этот же блок по коду.
      landingId: landing.id,
      // Группа A/B/n-теста, через которую пришёл этот конкретный визит (см. комментарий у
      // параметра метода выше) — тот же мост, что и landingId, для PERSONAL_DM/BOT_DIRECT.
      abTestGroupId: abTestGroupId ?? null,
    };

    await this.redis.set(`start:${startCode}`, JSON.stringify(trackingData), 'EX', START_CODE_TTL_SECONDS);

    // Приблизительная страна для последующего вступления в приватный канал (запрос
    // пользователя 2026-07-04) — только PRIVATE_CHANNEL_REQUEST не имеет другого способа
    // привязать geo (вступление идёт напрямую через Telegram, минуя tg-redirect/start-код,
    // см. TelegramProvider.handleJoinRequest). Ключ по landingId, не по startCode — заявка на
    // вступление не несёт с собой startCode для этого режима, только invite-ссылку лендинга.
    // TTL — осознанно приблизительно (см. комментарий у LANDING_VISIT_TTL_SECONDS выше).
    // !isBotUserAgent(...) — баг-репорт пользователя 2026-07-29 (см. комментарий у
    // BOT_USER_AGENT_PATTERN выше): без этой проверки визит краулера-предпросмотрщика (общий
    // ключ на весь лендинг, "последний побеждает") мог затереть реальную атрибуцию настоящего
    // посетителя прямо перед вступлением в канал.
    if (project.channel?.type === 'TELEGRAM' && project.channel.tgMode === 'PRIVATE_CHANNEL_REQUEST' && !isBotUserAgent(trackingData.userAgent)) {
      const country = this.resolveCountry(req);
      if (country) await this.redis.set(`landing-visit-country:${landing.id}`, country, 'EX', LANDING_VISIT_TTL_SECONDS);

      // Полный блок атрибуции (fbclid/ttclid/utm/пиксель/рекламные макросы) — тот же приём,
      // что и для country выше: PRIVATE_CHANNEL_REQUEST не проходит через start:<code>
      // (заявка на вступление не несёт код, только invite-ссылку), поэтому нужен отдельный
      // кэш по landingId, читается в TelegramProvider.handleJoinRequest. Раньше здесь
      // кэшировался ТОЛЬКО buyerRef (`landing-visit-buyer`) — баг-репорт пользователя
      // 2026-07-23: у новых подписчиков в PRIVATE_CHANNEL_REQUEST не было вообще никаких
      // FB-данных (кампания/пиксель/fbclid), а Subscribe/Dialogue-события переставали
      // доходить до Facebook после того, как 2026-07-21 отправку без реальной атрибуции
      // отключили (см. TrackingService.recordEvent hasAdAttribution) — эта атрибуция
      // никогда и не долетала до клиента для этого режима канала.
      const attribution = {
        fbclid: trackingData.fbclid,
        ttclid: trackingData.ttclid,
        // ip/userAgent/countryCode (запрос пользователя 2026-07-29, сверка с реальным примером
        // конкурента) — были доступны в trackingData прямо тут же, просто раньше не копировались
        // в этот отдельный кэш, из-за чего PRIVATE_CHANNEL_REQUEST-подписчики никогда не получали
        // их на Client, и Subscribe/Dialogue/Purchase уходили в Facebook с почти пустым user_data
        // (только external_id). fbp сюда не попадает при рендере страницы — cookie ставится
        // клиентским fbevents.js уже ПОСЛЕ ответа сервера, добавляется отдельно через
        // TrackingController.tgRedirect (?fbp= на клике по кнопке).
        ip: trackingData.ip,
        userAgent: trackingData.userAgent,
        countryCode: trackingData.countryCode,
        utmSource: trackingData.utmSource,
        utmMedium: trackingData.utmMedium,
        utmCampaign: trackingData.utmCampaign,
        utmContent: trackingData.utmContent,
        pixelId: adMacroData.pixelId,
        adId: adMacroData.adId,
        adName: adMacroData.adName,
        adsetId: adMacroData.adsetId,
        adsetName: adMacroData.adsetName,
        campaignId: adMacroData.campaignId,
        campaignName: adMacroData.campaignName,
        placement: adMacroData.placement,
        siteSourceName: adMacroData.siteSourceName,
        buyerRef: adMacroData.buyerRef,
        // Запрос пользователя 2026-08-20 — тот же мост, что и в trackingData выше, для
        // PRIVATE_CHANNEL_REQUEST (не проходит через start:<code>, см. комментарий у метода).
        abTestGroupId: abTestGroupId ?? null,
      };
      if (Object.values(attribution).some((v) => v != null)) {
        // Очередь визитов, не последнее значение (баг-репорт пользователя 2026-08-19, реальный
        // случай: клиент с чужим buyerId + клиенты вообще без buyerId + побитые рекламные
        // макросы на одном и том же лендинге) — раньше это был обычный SET, и комментарий выше
        // ("слишком долгий TTL повышает риск, что атрибуция ОДНОГО посетителя пришьётся к
        // вступлению СОВСЕМ ДРУГОГО человека") был известным, принятым тогда компромиссом; при
        // реальном трафике с нескольких объявлений/баеров на один лендинг риск оказался не
        // теоретическим — двое посетителей за 30-минутное окно перезаписывали друг друга, и
        // ПОСЛЕДНИЙ визит (в т.ч. без buyerRef или с чужим) прирастал к вступлению совсем другого
        // человека. RPUSH+LPOP вместо SET+GET — каждый визит встаёт в очередь, каждая заявка на
        // вступление разбирает её с начала (FIFO), а не читает одно и то же общее значение —
        // сохраняет тот же принцип "визит без явного вступления через TTL просто протухает"
        // (LTRIM ограничивает список на случай, если лендинг годами получает визиты без единого
        // вступления — не даёт ему расти бесконечно), но перестаёт путать атрибуцию РАЗНЫХ людей
        // друг с другом. Единственный оставшийся источник неточности — сам порядок: если кто-то
        // зашёл вторым, а вступил первым, ему может достаться атрибуция первого — тот же класс
        // приближения, что уже отдельно согласован для landing-visit-country ниже, но теперь
        // затрагивает только порядок внутри пары визитов, а не любые N визитов сразу.
        const key = `landing-visit-attribution:${landing.id}`;
        // Самоисцеление от переходного периода деплоя (найдено при живой проверке 2026-08-19):
        // ключ раньше был обычной строкой (SET), у уже существующих ключей, записанных ДО этого
        // деплоя, тип в Redis не меняется сам по себе, пока ключ не истечёт по старому TTL (до
        // 30 минут) — RPUSH на такой ключ бросает WRONGTYPE и уронил бы сам рендер лендинга для
        // живого посетителя. rpushSelfHealing подчищает такой ключ один раз и повторяет попытку.
        await this.rpushSelfHealing(key, JSON.stringify(attribution));
        await this.redis.ltrim(key, -500, -1);
        await this.redis.expire(key, LANDING_VISIT_TTL_SECONDS);
      }
    }

    html = html.replaceAll('{{START_CODE}}', startCode);

    // Обычный сайт (ChannelType.WEBSITE) — резолвим отложенный плейсхолдер из renderTemplate()
    // здесь, где уже есть req.query: прокидываем fbclid/utm/рекламные макросы визита прямо в
    // адрес сайта, чтобы track.js на самой странице сайта подхватил их через
    // window.location.search — без отдельного редирект-эндпоинта, сайт открывается напрямую.
    const websiteDestination = this.buildWebsiteDestination(project.channel, urlParams);
    if (websiteDestination) {
      html = html.replaceAll('{{TG_REDIRECT_URL}}', websiteDestination);
    }

    // Проект не привязан к одной платформе — пикселей одной и той же платформы
    // может быть несколько (несколько FB-аккаунтов и т.п.), поэтому ниже цикл,
    // а не одно фиксированное fbPixelId/ttPixelId.
    const fbPixels = project.pixels.filter((p) => p.platform === 'FACEBOOK');
    const ttPixels = project.pixels.filter((p) => p.platform === 'TIKTOK');

    // Авторедирект (запрос пользователя 2026-07-03) — та же /tg-redirect-ссылка, что и у
    // кнопки (см. TG_REDIRECT_URL в renderTemplate), просто с собственным startCode, т.к.
    // CUSTOM-лендинги вообще не проходят через renderTemplate/{{TG_REDIRECT_URL}}. Пустая
    // строка, если у проекта нет Telegram-канала и нет сайта — SDK тогда просто не найдёт
    // атрибут и ведёт себя как обычно (только PageView, без редиректа).
    const autoRedirectUrl =
      landing.autoRedirect && buildTelegramLink(project.channel)
        ? `${process.env.TG_REDIRECT_BASE_URL}/api/v1/track/${project.publicToken}/tg-redirect?code=${startCode}&landingId=${landing.id}`
        : landing.autoRedirect && websiteDestination
          ? websiteDestination
          : '';

    // age-gate-invite (запрос пользователя 2026-08-18) — единственный шаблон, где авторедирект
    // (если включён) не должен срабатывать сразу на загрузке страницы, а только когда
    // посетитель дойдёт до попапа 2 (попап 1 — просто вопрос "18+?", там редиректу не место).
    // track.js читает этот атрибут и вместо немедленного редиректа кладёт функцию в
    // window.tcrm.triggerAutoRedirect — сам template.html вызывает её в JS-обработчике клика
    // "Да"/POPUP1_YES_TEXT, ровно в момент открытия попапа 2 (см. apps/sdk/src/browser.ts).
    const deferAutoRedirect = landing.templateId === 'age-gate-invite';

    // Карта параметров (§ выше) прокидывается браузерному SDK тем же способом, что и
    // data-landing-id — иначе track.js не будет знать, под каким кастомным именем искать
    // ad_id/campaign_id/... в window.location.search этого конкретного проекта.
    const paramMapAttr = JSON.stringify(paramMap).replace(/"/g, '&quot;');

    const trackScriptUrl = `${process.env.CDN_URL}/track.js${sdkVersionHash ? `?v=${sdkVersionHash}` : ''}`;

    // Тексты попапа-подсказки (§ TiktokHintTextsDto) — тем же приёмом, что data-param-map: один
    // JSON-атрибут, а не 7 отдельных data-*, и только пропущенные/пустые ключи объекта попадают
    // в SDK, который сам подставляет свой встроенный английский дефолт на каждый отсутствующий
    // ключ (см. apps/sdk/src/browser.ts) — так что здесь достаточно передать as-is, без
    // подстановки дефолтов на бэкенде.
    const tiktokHintTextsAttr =
      landing.tiktokBrowserHint && landing.tiktokHintTexts
        ? `\n        data-tiktok-hint-texts="${JSON.stringify(landing.tiktokHintTexts).replace(/"/g, '&quot;')}"`
        : '';

    // Отложенный показ подсказки TikTok на age-gate-invite (запрос пользователя 2026-08-27, "на
    // 2-попаповом лендинге подсказка должна показываться только на втором/финальном попапе") —
    // тот же deferAutoRedirect выше (единственный шаблон с двумя попапами), тот же приём: SDK не
    // показывает подсказку сразу на попапе 1, а кладёт запуск в window.tcrm.triggerAutoRedirect,
    // который template.html уже и так вызывает ровно в момент открытия попапа 2 — самому шаблону
    // ничего менять не нужно (см. apps/sdk/src/browser.ts).
    const tiktokHintDeferAttr = landing.tiktokBrowserHint && deferAutoRedirect ? `\n        data-tiktok-hint-defer="true"` : '';

    const trackingScripts = `
<script src="${trackScriptUrl}"
        data-project-id="${project.publicToken}"
        data-api-url="${process.env.API_URL}/api/v1"
        data-landing-id="${landing.id}"${abTestGroupId ? `\n        data-ab-test-group-id="${abTestGroupId}"` : ''}
        data-param-map="${paramMapAttr}"${autoRedirectUrl ? `\n        data-auto-redirect-url="${autoRedirectUrl}"` : ''}${autoRedirectUrl && deferAutoRedirect ? `\n        data-auto-redirect-defer="true"` : ''}${landing.tiktokBrowserHint ? `\n        data-tiktok-browser-hint="true"` : ''}${tiktokHintTextsAttr}${tiktokHintDeferAttr}
        async></script>
${
  fbPixels.length > 0
    ? `
<!-- Facebook Pixel -->
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
${fbPixels.map((p) => `fbq('init','${p.pixelId}');`).join('\n')}
fbq('track','PageView',{eventID:'${nanoid(16)}'});
</script>
${fbPixels
  .map(
    (p) =>
      `<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${p.pixelId}&ev=PageView&noscript=1"/></noscript>`,
  )
  .join('\n')}`
    : ''
}
${
  ttPixels.length > 0
    ? `
<!-- TikTok Pixel -->
<script>
!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js",o=document.createElement("script");
o.type="text/javascript";o.async=!0;o.src=i+"?sdkid="+e+"&lib="+t;
var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
${ttPixels.map((p) => `ttq.load('${p.pixelId}');`).join('\n')}
ttq.page();}(window,document,'ttq');
</script>`
    : ''
}`;

    if (html.includes('</head>')) {
      html = html.replace('</head>', `${trackingScripts}\n</head>`);
    } else if (html.includes('<!-- TRACKING_PLACEHOLDER -->')) {
      html = html.replace('<!-- TRACKING_PLACEHOLDER -->', trackingScripts);
    } else {
      html = trackingScripts + html;
    }

    return html;
  }

  private getClientIp(req: Request): string {
    return (
      (req.headers['cf-connecting-ip'] as string) ||
      (req.headers['x-real-ip'] as string) ||
      req.socket.remoteAddress ||
      ''
    );
  }

  // Клиентские домены — self-service (см. 04_BACKEND_PROJECTS_DOMAINS.md): клиент сам
  // управляет DNS в своём аккаунте (Cloudflare или любой другой), платформа не держит
  // Cloudflare-токен и не гарантирует, что домен проксируется через Cloudflare. Поэтому
  // cf-ipcountry — только быстрый путь, когда он есть, а не единственный источник:
  // офлайн-геобаза geoip-lite по IP работает для любого домена независимо от того, стоит
  // ли перед ним Cloudflare.
  private resolveCountry(req: Request): string | null {
    const cfCountry = req.headers['cf-ipcountry'] as string | undefined;
    // "XX" — Cloudflare не смог определить страну, "T1" — Tor. Ни то ни другое не считаем
    // реальным ответом, чтобы не пропустить их через allow-list по ошибке.
    if (cfCountry && cfCountry !== 'XX' && cfCountry !== 'T1') return cfCountry.toUpperCase();

    const ip = this.getClientIp(req);
    if (!ip) return null;
    return geoip.lookup(ip)?.country ?? null;
  }

  private isCountryAllowed(req: Request, allowedCountries: string[]): boolean {
    const country = this.resolveCountry(req);
    // Страна не определилась вообще — считаем посетителя НЕ разрешённым (безопаснее
    // спрятать лендинг лишний раз, чем случайно показать его тому, от кого клоакинг должен
    // скрывать — весь смысл опции в том, чтобы не светить лендинг перед не-целевой
    // аудиторией/модерацией рекламных сетей).
    if (!country) return false;
    return allowedCountries.includes(country);
  }
}
