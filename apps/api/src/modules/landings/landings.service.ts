import * as fs from 'fs/promises';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AbTestGroup, Landing, LandingStatus, Permission, Prisma, UserRole } from '@prisma/client';
import { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { dailyBucketSql } from '../../common/timezone.util';
import { TelegramProvider } from '../channels/providers/telegram.provider';
import { ChannelsService } from '../channels/channels.service';
import { ProjectsService } from '../projects/projects.service';
import { StorageService } from './storage.service';
import { CreateLandingFromTemplateDto } from './dto/create-landing-from-template.dto';
import { UploadCustomLandingDto } from './dto/upload-custom-landing.dto';
import { UpdateLandingDto } from './dto/update-landing.dto';
import { AbTestMemberDto, CreateAbTestGroupDto, UpdateAbTestGroupDto } from './dto/ab-test-group.dto';

const MAX_ZIP_SIZE = 50 * 1024 * 1024;
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

// Суммирует несколько дневных рядов ({date, count}[], уже сгруппированных по дню в часовом
// поясе проекта — см. dailyBucketSql) в один общий ряд по группе A/B-теста (LandingsService.
// getGroupStats) — date у $queryRaw приходит как Date-объект, приводим к ISO-дате, чтобы разные
// участники с одной и той же датой сложились в одну точку графика, а не легли рядом.
function mergeDailySeries(series: { date: Date; count: number }[][]): { date: string; count: number }[] {
  const totals = new Map<string, number>();
  for (const s of series) {
    for (const point of s) {
      const key = new Date(point.date).toISOString().slice(0, 10);
      totals.set(key, (totals.get(key) ?? 0) + point.count);
    }
  }
  return Array.from(totals.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  previewUrl: string;
  customizableFields: string[];
  // false — виден в списке, но недоступен для выбора (запрос пользователя 2026-07-05,
  // tg-invite-light "поставь недоступно, светлую пришлю позже"). Отсутствие поля = доступен,
  // как и у всех шаблонов до этого — не нужно проставлять true везде.
  available?: boolean;
}

// Проект и канал — 1:1 с 2026-07-02 (см. Project.channel в schema.prisma), дизамбигуация
// "какой канал считается ведущим" из нескольких больше не нужна — просто select одного
// канала. type в select — карточка лендинга должна отличать Telegram от WhatsApp/Instagram
// (только для Telegram есть реальные deep-link/аватар, см. LandingRendererService).
const PROJECT_CHANNEL_SELECT = {
  select: {
    id: true,
    type: true,
    tgChannelTitle: true,
    tgBotFirstName: true,
    tgChannelUsername: true,
    tgBotUsername: true,
    tgPersonalUsername: true,
    tgChannelMembersCount: true,
    tgAvatarFileId: true,
  },
};

const LANDING_WITH_CONTEXT_INCLUDE = {
  project: { select: { id: true, name: true, channel: PROJECT_CHANNEL_SELECT } },
  // clients: {where: deletedAt:null} — иначе _count включает софт-удалённых клиентов
  // (см. тот же баг на карточке проекта, ProjectsService, 2026-07-03).
  _count: { select: { clients: { where: { deletedAt: null } } } },
  // Название группы A/B-теста (запрос пользователя 2026-07-17) — чтобы список лендингов мог
  // показать бейдж "Тест: <название>" вместо generic "A/B-тест", без отдельного запроса.
  abTestGroup: { select: { name: true } },
  // Автор (запрос пользователя 2026-08-03) — null у лендингов без резолвящегося создателя
  // (например, если User был бы хард-удалён, чего в этом проекте не бывает — см. инвариант в
  // CLAUDE.md, поле просто на будущее совместимо с этим случаем).
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.LandingInclude;

export type LandingWithContext = Prisma.LandingGetPayload<{ include: typeof LANDING_WITH_CONTEXT_INCLUDE }>;

@Injectable()
export class LandingsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private telegramProvider: TelegramProvider,
    private channelsService: ChannelsService,
    private projectsService: ProjectsService,
  ) {}

  async getTemplates(): Promise<TemplateInfo[]> {
    return [
      {
        id: 'minimal',
        name: 'Minimal',
        description: 'Чистый минималистичный дизайн',
        previewUrl: `${process.env.CDN_URL}/templates/minimal/preview.jpg`,
        customizableFields: ['PRIMARY_COLOR', 'BG_COLOR', 'JOIN_BUTTON_TEXT'],
      },
      {
        id: 'gradient',
        name: 'Gradient',
        description: 'Яркий градиентный фон',
        previewUrl: `${process.env.CDN_URL}/templates/gradient/preview.jpg`,
        customizableFields: ['GRADIENT_FROM', 'GRADIENT_TO', 'JOIN_BUTTON_TEXT'],
      },
      {
        id: 'dark',
        name: 'Dark',
        description: 'Тёмная премиум тема',
        previewUrl: `${process.env.CDN_URL}/templates/dark/preview.jpg`,
        customizableFields: ['PRIMARY_COLOR', 'JOIN_BUTTON_TEXT'],
      },
      // Воссоздают стандартную страницу предпросмотра канала Telegram (t.me/<username>) —
      // запрос пользователя 2026-07-04: "дефолтный лендинг от телеграм, светлая/тёмная".
      // Цвета/размеры сверены напрямую с telegram.org/css/telegram.css, см. комментарий
      // в самих template.html.
      {
        id: 'telegram-light',
        name: 'Telegram (светлая)',
        description: 'Как стандартная страница канала в Telegram, светлая тема',
        previewUrl: `${process.env.CDN_URL}/templates/telegram-light/preview.jpg`,
        customizableFields: ['PRIMARY_COLOR', 'JOIN_BUTTON_TEXT'],
      },
      {
        id: 'telegram-dark',
        name: 'Telegram (тёмная)',
        description: 'Как стандартная страница канала в Telegram, тёмная тема',
        previewUrl: `${process.env.CDN_URL}/templates/telegram-dark/preview.jpg`,
        customizableFields: ['PRIMARY_COLOR', 'JOIN_BUTTON_TEXT'],
      },
      // Готовая вёрстка из архива tg_invite (запрос пользователя 2026-07-05, светлая тема
      // добавлена 2026-07-15 из tg_invite_light.zip) — фиксированный хедер с логотипом
      // Telegram/Download, повторяющийся узор фона (реальный bg.svg, захостен на CDN, не
      // CSS-имитация; светлая и тёмная темы переиспользуют один и тот же файл — побайтово
      // идентичен в обоих архивах, см. tg-invite-light/template.html).
      {
        id: 'tg-invite-dark',
        name: 'Tg Invite (тёмная)',
        description: 'Готовый дизайн приглашения в канал с хедером и узором фона, тёмная тема',
        previewUrl: `${process.env.CDN_URL}/templates/tg-invite-dark/preview.jpg`,
        customizableFields: ['PRIMARY_COLOR', 'JOIN_BUTTON_TEXT'],
      },
      {
        id: 'tg-invite-light',
        name: 'Tg Invite (светлая)',
        description: 'Готовый дизайн приглашения в канал с хедером и узором фона, светлая тема',
        previewUrl: `${process.env.CDN_URL}/templates/tg-invite-light/preview.jpg`,
        customizableFields: ['PRIMARY_COLOR', 'JOIN_BUTTON_TEXT'],
      },
      // Из архива, который прислал пользователь 2026-08-18 (new_landing.7z) — единственный
      // шаблон с двумя попапами вместо одного экрана: попап 1 — вопрос "18+?" (Да/Нет), попап 2
      // открывается только по "Да" и несёт финальный призыв к действию. "Нет" в попапе 1 и
      // кнопка попапа 2 оба ведут на TG_REDIRECT_URL — единственный переход, который НЕ ведёт
      // туда, это "Да" (только раскрывает попап 2 на той же странице). Если на лендинге включён
      // авторедирект — он срабатывает только при переходе на попап 2, см. комментарий в
      // LandingRendererService.injectTrackingScripts.
      {
        id: 'age-gate-invite',
        name: 'Проверка возраста + приглашение',
        description: 'Два попапа: подтверждение возраста 18+, затем приглашение подписаться на канал — все тексты и кнопки обоих попапов редактируются',
        previewUrl: `${process.env.CDN_URL}/templates/age-gate-invite/preview.jpg`,
        customizableFields: ['POPUP1_TITLE', 'POPUP1_TEXT', 'POPUP1_YES_TEXT', 'POPUP1_NO_TEXT', 'POPUP2_TITLE', 'POPUP2_TEXT', 'POPUP2_BUTTON_TEXT'],
      },
    ];
  }

  // companyId приходит из контекста авторизации (контроллер передаёт его явно),
  // не из тела запроса — в доке dto.companyId был полем DTO, что позволяло бы
  // клиенту указать ЧУЖОЙ companyId и создать лендинг не в своей компании.
  // createdById — запрос пользователя 2026-08-03, тот же паттерн, что уже есть у
  // Purchase.registeredBy (кто выполнил действие, опционально).
  async createFromTemplate(projectId: string, companyId: string, dto: CreateLandingFromTemplateDto, createdById?: string): Promise<Landing> {
    // "Изначально стоит как в канале" (запрос пользователя 2026-07-04) — если пользователь не
    // указал число подписчиков вручную, подставляем реальное текущее число участников канала
    // (Channel.tgChannelMembersCount, подтягивается в TelegramProvider.fetchAndSaveMetadata).
    // Разово на момент создания, не пересчитывается на каждый рендер — дальше это обычное
    // редактируемое поле лендинга, а не всегда-живой счётчик.
    let subscribersCount = dto.subscribersCount;
    if (subscribersCount === undefined) {
      const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { channel: { select: { tgChannelMembersCount: true } } } });
      if (project?.channel?.tgChannelMembersCount != null) {
        subscribersCount = String(project.channel.tgChannelMembersCount);
      }
    }

    const created = await this.prisma.landing.create({
      data: {
        projectId,
        companyId,
        createdById,
        name: dto.name,
        type: 'TEMPLATE',
        templateId: dto.templateId,
        templateData: {
          PRIMARY_COLOR: dto.primaryColor || '#2AABEE',
          BG_COLOR: dto.bgColor || '#f0f4f8',
          GRADIENT_FROM: dto.gradientFrom || '#667eea',
          GRADIENT_TO: dto.gradientTo || '#764ba2',
          JOIN_BUTTON_TEXT: dto.buttonText || 'Вступить в канал',
          CHANNEL_TITLE: dto.channelTitle || '',
          CHANNEL_DESCRIPTION: dto.channelDescription || '',
          CHANNEL_AVATAR: dto.channelAvatar || '',
          SUBSCRIBERS_COUNT: subscribersCount || '',
          SUBSCRIBERS_LABEL: dto.subscribersLabel || 'подписчиков',
          // age-gate-invite (запрос пользователя 2026-08-18, доперевод 2026-08-18) — оба попапа
          // на испанском (html lang="es"): попап 1 изначально был на итальянском при испанском
          // lang — пользователь считал его испанским с самого начала, переведено на настоящий
          // испанский, а не оставлено рассинхроном; попап 2 был на русском ("подписаться на
          // канал") — тоже переведён на испанский, чтобы оба попапа были на одном языке.
          POPUP1_TITLE: dto.popup1Title || '¿Tienes más de 18 años?',
          POPUP1_TEXT: dto.popup1Text || 'Debes tener 18 años para continuar',
          POPUP1_YES_TEXT: dto.popup1YesText || 'Sí',
          POPUP1_NO_TEXT: dto.popup1NoText || 'No',
          POPUP2_TITLE: dto.popup2Title || '¡Suscríbete a nuestro canal!',
          POPUP2_TEXT: dto.popup2Text || '',
          POPUP2_BUTTON_TEXT: dto.popup2ButtonText || 'Unirse al canal',
        },
        metaTitle: dto.metaTitle,
        metaDescription: dto.metaDescription,
        status: LandingStatus.DRAFT,
        autoRedirect: dto.autoRedirect,
        cloakingEnabled: dto.cloakingEnabled,
        cloakingCountries: dto.cloakingCountries,
        cloakingRedirectUrl: dto.cloakingRedirectUrl || null,
      },
    });
    // Автопубликация (запрос пользователя 2026-08-20: "при создании лэндинга он автоматом
    // должен быть включен") — раньше лендинг создавался DRAFT и оставался невидимым в трекинге,
    // пока пользователь не нажмёт "Опубликовать" отдельно; через publish(), а не голое
    // status: PUBLISHED в create() выше, чтобы не терять существующую логику первой публикации
    // (создание персональной invite-ссылки для PRIVATE_CHANNEL_REQUEST-атрибуции, см. publish()).
    return this.publish(created.id, companyId);
  }

  async findAll(projectId: string, companyId: string): Promise<LandingWithContext[]> {
    return this.prisma.landing.findMany({
      where: { projectId, companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: LANDING_WITH_CONTEXT_INCLUDE,
    });
  }

  // Для отдельной страницы "все лендинги" (не через конкретный проект) — та же форма
  // ответа, что и findAll выше, просто без фильтра по projectId.
  // Багфикс 2026-07-28 (per-project разрешения): раньше фильтровал только по членству в
  // проекте (ProjectAccess) — Buyer с LANDINGS_VIEW только на Проекте A всё равно видел
  // лендинги Проекта B в общем списке, если у него там просто было ProjectAccess. Теперь
  // фильтруем по конкретным projectId, где выдано именно LANDINGS_VIEW.
  // Расширено 2026-08-03: не-элевейтед роли теперь дополнительно смотрят на
  // User.landingsVisibilityScope — OWN_LANDINGS сужает до собственных лендингов,
  // ALL_LANDINGS снимает фильтр по проектам совсем, PROJECT_LANDINGS = прежнее поведение (дефолт).
  async findAllForCompany(companyId: string, userId: string, role: UserRole): Promise<LandingWithContext[]> {
    const elevatedRoles: UserRole[] = [UserRole.OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN];
    let scopeFilter: Prisma.LandingWhereInput = {};
    if (!elevatedRoles.includes(role)) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { landingsVisibilityScope: true } });
      const scope = user?.landingsVisibilityScope ?? 'PROJECT_LANDINGS';

      if (scope === 'OWN_LANDINGS') {
        scopeFilter = { createdById: userId };
      } else if (scope !== 'ALL_LANDINGS') {
        const grants = await this.prisma.userPermission.findMany({
          where: { userId, permission: 'LANDINGS_VIEW' },
          select: { projectId: true },
        });
        scopeFilter = { project: { id: { in: grants.map((g) => g.projectId) } } };
      }
    }
    return this.prisma.landing.findMany({
      where: { companyId, deletedAt: null, ...scopeFilter },
      orderBy: { createdAt: 'desc' },
      include: LANDING_WITH_CONTEXT_INCLUDE,
    });
  }

  // createdBy (запрос пользователя 2026-08-03) — добавлен сюда, а не только в
  // LANDING_WITH_CONTEXT_INCLUDE, потому что findOne — единственный путь, которым страница
  // одного лендинга (GET /landings/:id и, через getStats ниже, GET /landings/:id/stats)
  // получает данные лендинга; остальные поля Landing, читаемые вызовами findOne по всему
  // файлу, не задеты — include добавляет поле, не убирает и не меняет существующие.
  async findOne(id: string, companyId: string): Promise<Landing & { createdBy: { id: string; firstName: string; lastName: string | null } | null }> {
    const landing = await this.prisma.landing.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!landing) throw new NotFoundException('Лендинг не найден');
    return landing;
  }

  // Подробная статистика одного лендинга (запрос пользователя 2026-07-03) — подписчики
  // (Client.landingId — точная атрибуция, см. TelegramProvider.handleJoinRequest) и
  // верхняя часть воронки (PageView/Lead — TrackingEvent.payload.landingId, проставляется
  // SDK через data-landing-id, см. apps/sdk/src/browser.ts). Purchase туда же не входит —
  // покупки в этом проекте пока не привязаны к лендингу нигде в пайплайне.
  //
  // Вынесено в отдельный метод (Фаза 3.2, A/B-тестирование) — getStats зовёт его один раз
  // для самого лендинга и, если тот участвует в A/B-тесте, ещё раз для варианта B.
  // createdBy?: — опционально, не Landing (тип этого параметра): getStats передаёт сюда
  // результат findOne (несёт createdBy), а getGroupStats/A/B-варианты выше передают лендинги
  // из обычного prisma.landing.findMany без include (createdBy не нужен для строк сравнения
  // вариантов — только для заголовка самого лендинга/группы).
  private async computeLandingStats(
    landing: Landing & { createdBy?: { id: string; firstName: string; lastName: string | null } | null },
    timezone: string,
  ) {
    const id = landing.id;
    const subscribedBucket = dailyBucketSql('subscribedAt', timezone);
    const dialogueBucket = dailyBucketSql('firstDialogueAt', timezone);

    const [total, active, unsubscribed, pageViews, leads, dialogues, dailySubscribers, dailyDialogues, domainPath] = await Promise.all([
      this.prisma.client.count({ where: { landingId: id, deletedAt: null } }),
      this.prisma.client.count({ where: { landingId: id, deletedAt: null, isSubscribed: true } }),
      this.prisma.client.count({ where: { landingId: id, deletedAt: null, isSubscribed: false } }),
      this.prisma.trackingEvent.count({
        where: { projectId: landing.projectId, eventName: 'PageView', payload: { path: ['landingId'], equals: id } },
      }),
      this.prisma.trackingEvent.count({
        where: { projectId: landing.projectId, eventName: 'Lead', payload: { path: ['landingId'], equals: id } },
      }),
      // Диалоги, атрибутированные этому лендингу (запрос пользователя 2026-07-04, "откуда
      // пришёл диалог") — Client.landingId уже несёт атрибуцию (invite-ссылка лендинга для
      // ботовых каналов, разобранный трекинг-код для PERSONAL_DM, см. TelegramPersonalService).
      this.prisma.client.count({ where: { landingId: id, deletedAt: null, firstDialogueAt: { not: null } } }),
      // ::int — COUNT(*) иначе bigint, JSON.stringify не умеет его сериализовать
      // (тот же баг, что чинили в ProjectsService.getOverview, 2026-07-03).
      this.prisma.$queryRaw<{ date: Date; count: number }[]>`
        SELECT ${subscribedBucket} as date, COUNT(*)::int as count
        FROM "Client"
        WHERE "landingId" = ${id} AND "deletedAt" IS NULL AND "subscribedAt" IS NOT NULL
        GROUP BY date
        ORDER BY date ASC
      `,
      this.prisma.$queryRaw<{ date: Date; count: number }[]>`
        SELECT ${dialogueBucket} as date, COUNT(*)::int as count
        FROM "Client"
        WHERE "landingId" = ${id} AND "deletedAt" IS NULL AND "firstDialogueAt" IS NOT NULL
        GROUP BY date
        ORDER BY date ASC
      `,
      this.prisma.domainPath.findFirst({ where: { landingId: id }, include: { domain: { select: { domain: true } } } }),
    ]);

    return {
      landing: { id: landing.id, name: landing.name, type: landing.type, status: landing.status, createdBy: landing.createdBy ?? null },
      subscribers: { total, active, unsubscribed },
      funnel: { pageViews, leads, subscribes: total },
      dialogues: { total: dialogues, dailyDialogues },
      dailySubscribers,
      attachment: domainPath ? { domain: domainPath.domain.domain, path: domainPath.path } : null,
    };
  }

  // Статистика ОДНОГО участника A/B/n-теста СТРОГО в рамках самой группы (запрос пользователя
  // 2026-08-20: "не нужно учитывать статистику каждого лэндинга по отдельности, даже если эти
  // лэндинги проливаются отдельно... группа лэндингов как отдельная сущность со своей статой
  // разделенной") — заменяет более раннюю попытку через computeLandingStats(..., since:
  // group.createdAt): тот подход всё ещё приплюсовывал к тесту ЛЮБОЙ трафик на лендинг-участника
  // после старта теста, включая его собственную отдельную рекламу через прямую ссылку на тот же
  // лендинг. Здесь фильтр строго по Client.abTestGroupId/TrackingEvent.payload.abTestGroupId —
  // стемпится ТОЛЬКО когда конкретный визит реально пришёл через сплит ЭТОЙ группы (см.
  // LandingRendererService.injectTrackingScripts) — независимо от Landing.abTestGroupId (текущее
  // членство) и независимо от того, что ещё происходит с этим лендингом по другим ссылкам.
  // Не ретроактивно: трафик, случившийся ДО деплоя этой правки, никогда не получал тег и не
  // войдёт в счёт, даже для уже запущенных на тот момент тестов — тот же принцип, что и у
  // pixelId/campaignId/buyerId в своё время (см. комментарии в schema.prisma).
  private async computeAbTestGroupMemberStats(
    landing: Landing,
    groupId: string,
    timezone: string,
  ) {
    const id = landing.id;
    const subscribedBucket = dailyBucketSql('subscribedAt', timezone);
    const dialogueBucket = dailyBucketSql('firstDialogueAt', timezone);

    const [total, active, unsubscribed, pageViews, leads, dialogues, dailySubscribers, dailyDialogues, domainPath] = await Promise.all([
      this.prisma.client.count({ where: { landingId: id, abTestGroupId: groupId, deletedAt: null } }),
      this.prisma.client.count({ where: { landingId: id, abTestGroupId: groupId, deletedAt: null, isSubscribed: true } }),
      this.prisma.client.count({ where: { landingId: id, abTestGroupId: groupId, deletedAt: null, isSubscribed: false } }),
      this.prisma.trackingEvent.count({
        where: {
          projectId: landing.projectId,
          eventName: 'PageView',
          AND: [{ payload: { path: ['landingId'], equals: id } }, { payload: { path: ['abTestGroupId'], equals: groupId } }],
        },
      }),
      this.prisma.trackingEvent.count({
        where: {
          projectId: landing.projectId,
          eventName: 'Lead',
          AND: [{ payload: { path: ['landingId'], equals: id } }, { payload: { path: ['abTestGroupId'], equals: groupId } }],
        },
      }),
      this.prisma.client.count({ where: { landingId: id, abTestGroupId: groupId, deletedAt: null, firstDialogueAt: { not: null } } }),
      this.prisma.$queryRaw<{ date: Date; count: number }[]>`
        SELECT ${subscribedBucket} as date, COUNT(*)::int as count
        FROM "Client"
        WHERE "landingId" = ${id} AND "abTestGroupId" = ${groupId} AND "deletedAt" IS NULL AND "subscribedAt" IS NOT NULL
        GROUP BY date
        ORDER BY date ASC
      `,
      this.prisma.$queryRaw<{ date: Date; count: number }[]>`
        SELECT ${dialogueBucket} as date, COUNT(*)::int as count
        FROM "Client"
        WHERE "landingId" = ${id} AND "abTestGroupId" = ${groupId} AND "deletedAt" IS NULL AND "firstDialogueAt" IS NOT NULL
        GROUP BY date
        ORDER BY date ASC
      `,
      this.prisma.domainPath.findFirst({ where: { landingId: id }, include: { domain: { select: { domain: true } } } }),
    ]);

    return {
      landing: { id: landing.id, name: landing.name, type: landing.type, status: landing.status, createdBy: null },
      subscribers: { total, active, unsubscribed },
      funnel: { pageViews, leads, subscribes: total },
      dialogues: { total: dialogues, dailyDialogues },
      dailySubscribers,
      attachment: domainPath ? { domain: domainPath.domain.domain, path: domainPath.path } : null,
    };
  }

  async getStats(id: string, companyId: string) {
    const landing = await this.findOne(id, companyId);
    // Часовой пояс проекта (запрос пользователя 2026-07-04) — "сутки" на дневных графиках
    // этого лендинга считаются по зоне его проекта, не по UTC, см. common/timezone.util.ts.
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: landing.projectId }, select: { timezone: true } });
    const stats = await this.computeLandingStats(landing, project.timezone);

    if (!landing.abTestGroupId) return stats;

    // Остальные живые участники той же группы — сравнение вариантов внутри теста считается
    // строго по трафику, реально пришедшему через сплит ЭТОЙ группы (запрос пользователя
    // 2026-08-20, см. комментарий у computeAbTestGroupMemberStats), не по "всё время жизни
    // лендинга" и не по грубой отсечке с момента старта теста. Сам stats выше (не в контексте
    // сравнения) намеренно берёт полную историю лендинга — собственная страница лендинга не
    // должна терять данные о его прямом трафике независимо от того, участвует ли он в тесте.
    const members = await this.prisma.landing.findMany({ where: { abTestGroupId: landing.abTestGroupId, deletedAt: null } });
    if (members.length < 2) return stats;
    const memberStats = await Promise.all(
      members.map(async (m) => ({ weight: m.abTestWeight ?? 0, ...(await this.computeAbTestGroupMemberStats(m, landing.abTestGroupId!, project.timezone)) })),
    );

    return { ...stats, abTestGroup: { groupId: landing.abTestGroupId, members: memberStats } };
  }

  // Статистика A/B/n-группы САМОЙ ПО СЕБЕ (запрос пользователя 2026-07-23: "для груп лэндингов
  // тоже нужна статистика как для обычных лэндингов, сейчас просто есть группа без статистики
  // на которую можно зайти как в обычный лэндинг") — раньше per-variant цифры (getStats выше)
  // были видны, только если открыть СТРАНИЦУ ОДНОГО ИЗ УЧАСТНИКОВ; у самой группы (карточка в
  // /landings) не было вообще никакого экрана статистики. Работает для обеих стадий теста:
  // активный — считает live (та же computeLandingStats, что и обычный лендинг), завершённый —
  // берёт застывший resultsSnapshot (stopAbTestGroup), тот же принцип, что уже показывает
  // страница /landings/history, просто с суммой по всем вариантам добавленной сверху.
  async getGroupStats(groupId: string, companyId: string) {
    const group = await this.prisma.abTestGroup.findFirst({ where: { id: groupId, companyId, deletedAt: null } });
    if (!group) throw new NotFoundException('Группа A/B-теста не найдена');

    if (group.endedAt) {
      const snapshot = (group.resultsSnapshot as unknown as
        | { landingId: string; name: string; weight: number | null; pageViews: number; leads: number; subscribes: number; dialogues: number }[]
        | null) ?? [];
      const totals = snapshot.reduce(
        (acc, m) => ({
          pageViews: acc.pageViews + m.pageViews,
          leads: acc.leads + m.leads,
          subscribes: acc.subscribes + m.subscribes,
          dialogues: acc.dialogues + m.dialogues,
        }),
        { pageViews: 0, leads: 0, subscribes: 0, dialogues: 0 },
      );
      return { groupId: group.id, name: group.name, endedAt: group.endedAt, members: snapshot, totals };
    }

    const members = await this.prisma.landing.findMany({ where: { abTestGroupId: groupId, deletedAt: null } });
    if (!members.length) throw new NotFoundException('В группе не осталось лендингов');

    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: group.projectId }, select: { timezone: true } });
    // Строго трафик группы (запрос пользователя 2026-08-20) — см. полный комментарий у
    // computeAbTestGroupMemberStats выше.
    const memberStats = await Promise.all(
      members.map(async (m) => ({ weight: m.abTestWeight ?? 0, ...(await this.computeAbTestGroupMemberStats(m, groupId, project.timezone)) })),
    );

    const totals = memberStats.reduce(
      (acc, m) => ({
        pageViews: acc.pageViews + m.funnel.pageViews,
        leads: acc.leads + m.funnel.leads,
        subscribes: acc.subscribes + m.funnel.subscribes,
        subscribersActive: acc.subscribersActive + m.subscribers.active,
        subscribersUnsubscribed: acc.subscribersUnsubscribed + m.subscribers.unsubscribed,
        dialogues: acc.dialogues + m.dialogues.total,
      }),
      { pageViews: 0, leads: 0, subscribes: 0, subscribersActive: 0, subscribersUnsubscribed: 0, dialogues: 0 },
    );

    return {
      groupId: group.id,
      name: group.name,
      endedAt: null,
      members: memberStats,
      totals,
      dailySubscribers: mergeDailySeries(memberStats.map((m) => m.dailySubscribers)),
      dailyDialogues: mergeDailySeries(memberStats.map((m) => m.dialogues.dailyDialogues)),
    };
  }

  async update(id: string, companyId: string, dto: UpdateLandingDto): Promise<Landing> {
    const landing = await this.findOne(id, companyId);

    const existingData = (landing.templateData as Record<string, string>) || {};
    const templateDataPatch: Record<string, string> = {};
    if (dto.primaryColor !== undefined) templateDataPatch.PRIMARY_COLOR = dto.primaryColor;
    if (dto.bgColor !== undefined) templateDataPatch.BG_COLOR = dto.bgColor;
    if (dto.gradientFrom !== undefined) templateDataPatch.GRADIENT_FROM = dto.gradientFrom;
    if (dto.gradientTo !== undefined) templateDataPatch.GRADIENT_TO = dto.gradientTo;
    if (dto.buttonText !== undefined) templateDataPatch.JOIN_BUTTON_TEXT = dto.buttonText;
    if (dto.channelTitle !== undefined) templateDataPatch.CHANNEL_TITLE = dto.channelTitle;
    if (dto.channelDescription !== undefined) templateDataPatch.CHANNEL_DESCRIPTION = dto.channelDescription;
    if (dto.channelAvatar !== undefined) templateDataPatch.CHANNEL_AVATAR = dto.channelAvatar;
    if (dto.subscribersCount !== undefined) templateDataPatch.SUBSCRIBERS_COUNT = dto.subscribersCount;
    if (dto.subscribersLabel !== undefined) templateDataPatch.SUBSCRIBERS_LABEL = dto.subscribersLabel;
    if (dto.popup1Title !== undefined) templateDataPatch.POPUP1_TITLE = dto.popup1Title;
    if (dto.popup1Text !== undefined) templateDataPatch.POPUP1_TEXT = dto.popup1Text;
    if (dto.popup1YesText !== undefined) templateDataPatch.POPUP1_YES_TEXT = dto.popup1YesText;
    if (dto.popup1NoText !== undefined) templateDataPatch.POPUP1_NO_TEXT = dto.popup1NoText;
    if (dto.popup2Title !== undefined) templateDataPatch.POPUP2_TITLE = dto.popup2Title;
    if (dto.popup2Text !== undefined) templateDataPatch.POPUP2_TEXT = dto.popup2Text;
    if (dto.popup2ButtonText !== undefined) templateDataPatch.POPUP2_BUTTON_TEXT = dto.popup2ButtonText;

    return this.prisma.landing.update({
      where: { id },
      data: {
        name: dto.name,
        metaTitle: dto.metaTitle,
        metaDescription: dto.metaDescription,
        templateData: { ...existingData, ...templateDataPatch } as Prisma.InputJsonValue,
        autoRedirect: dto.autoRedirect,
        cloakingEnabled: dto.cloakingEnabled,
        cloakingCountries: dto.cloakingCountries,
        // '' от клиента — явная очистка (см. UpdateLandingDto), иначе Prisma записала бы
        // пустую строку как значение вместо NULL.
        cloakingRedirectUrl: dto.cloakingRedirectUrl === '' ? null : dto.cloakingRedirectUrl,
      },
    });
  }

  // Создать новый CUSTOM-лендинг сразу из ZIP — отдельно от createFromTemplate,
  // чтобы в UI не нужен был промежуточный "создать пустой лендинг, потом загрузить в него ZIP".
  async createCustom(projectId: string, companyId: string, dto: UploadCustomLandingDto, file: Express.Multer.File, createdById?: string): Promise<Landing> {
    const landing = await this.prisma.landing.create({
      data: { projectId, companyId, createdById, name: dto.name, type: 'CUSTOM', status: LandingStatus.DRAFT },
    });
    const uploaded = await this.processZipUpload(landing, file);
    // Автопубликация (запрос пользователя 2026-08-20) — см. полный комментарий в createFromTemplate.
    return this.publish(uploaded.id, companyId);
  }

  // Перезалить ZIP в существующий лендинг (первая загрузка переводит его в CUSTOM,
  // повторная — заменяет файлы, например при TEMPLATE → CUSTOM миграции или правке вёрстки).
  async uploadCustomLanding(id: string, companyId: string, file: Express.Multer.File): Promise<Landing> {
    const landing = await this.findOne(id, companyId);
    return this.processZipUpload(landing, file);
  }

  private async processZipUpload(landing: Landing, file: Express.Multer.File): Promise<Landing> {
    if (!file) throw new BadRequestException('Файл не передан');
    if (!file.originalname.toLowerCase().endsWith('.zip') && file.mimetype !== 'application/zip') {
      throw new BadRequestException('Только ZIP-файлы');
    }
    if (file.size > MAX_ZIP_SIZE) {
      throw new BadRequestException('Максимальный размер ZIP — 50MB');
    }

    const extractPath = path.join('/tmp', `landing-${landing.id}-${Date.now()}`);

    let zip: AdmZip;
    try {
      zip = new AdmZip(file.buffer);
    } catch {
      throw new BadRequestException('Не удалось прочитать ZIP-архив');
    }

    // Защита от zip-slip помимо встроенной в adm-zip (>=0.5.2) — не доверяем единственному
    // слою защиты при работе с файлами, загруженными произвольным пользователем.
    for (const entry of zip.getEntries()) {
      if (entry.entryName.includes('..') || path.isAbsolute(entry.entryName)) {
        throw new BadRequestException('Архив содержит недопустимые пути');
      }
    }

    const hasIndex = zip.getEntries().some((e) => e.entryName.toLowerCase() === 'index.html');
    if (!hasIndex) {
      throw new BadRequestException('ZIP должен содержать index.html в корне архива');
    }

    try {
      zip.extractAllTo(extractPath, true);

      const basePath = `landings/${landing.id}`;
      await this.storage.removePrefix(basePath);
      await this.storage.uploadDirectory(extractPath, basePath);

      return this.prisma.landing.update({
        where: { id: landing.id },
        data: { type: 'CUSTOM', customBasePath: basePath, templateId: null, templateData: Prisma.JsonNull },
      });
    } finally {
      await fs.rm(extractPath, { recursive: true, force: true }).catch(() => {});
    }
  }

  async publish(id: string, companyId: string): Promise<Landing> {
    const landing = await this.findOne(id, companyId);

    // Персональная invite-ссылка лендинга (PRIVATE_CHANNEL_REQUEST) — для точной
    // пер-лендинговой атрибуции подписчиков (Client.landingId, см.
    // TelegramProvider.handleJoinRequest). Создаём один раз, при первой публикации — не
    // при каждом рендере страницы, внешний Telegram API-вызов не место в горячем пути
    // рендера. Если канал не Telegram/не в этом режиме, createLandingInviteLink вернёт
    // null и лендинг просто продолжит работать без пер-лендинговой атрибуции (fallback —
    // общая ссылка канала).
    if (!landing.tgInviteLink) {
      const project = await this.prisma.project.findUnique({ where: { id: landing.projectId }, include: { channel: true } });
      if (project?.channel) {
        const inviteLink = await this.telegramProvider.createLandingInviteLink(project.channel, landing.name);
        if (inviteLink) {
          return this.prisma.landing.update({ where: { id }, data: { status: LandingStatus.PUBLISHED, tgInviteLink: inviteLink } });
        }
      }
    }

    return this.prisma.landing.update({ where: { id }, data: { status: LandingStatus.PUBLISHED } });
  }

  async unpublish(id: string, companyId: string): Promise<Landing> {
    await this.findOne(id, companyId);
    return this.prisma.landing.update({ where: { id }, data: { status: LandingStatus.DRAFT } });
  }

  async remove(id: string, companyId: string): Promise<void> {
    await this.findOne(id, companyId);
    await this.prisma.landing.update({ where: { id }, data: { deletedAt: new Date(), status: LandingStatus.ARCHIVED } });
  }

  // A/B/n-тестирование лендингов (Фаза 3.2, запрос пользователя 2026-07-15, расширено тем же
  // днём с пары до произвольного числа вариантов) — баер связывает N уже существующих
  // лендингов в группу с процентами трафика на каждый, сплит делается в
  // LandingRendererService.resolveAbTestVariant.

  // Валидация состава при создании: id'ы без повторов, сумма weight === 100, все лендинги из
  // одного projectId (и текущей компании — findMany ниже уже неявно заскопирован
  // PrismaService-мидлварой), никто не состоит в чужой группе. Только для create — состав/веса
  // после создания больше не редактируются (запрос пользователя 2026-08-20, см.
  // UpdateAbTestGroupDto), поэтому currentGroupId-исключение "своя группа разрешена" больше не
  // нужно.
  private async assertValidMembers(projectId: string, members: AbTestMemberDto[]): Promise<void> {
    const ids = members.map((m) => m.landingId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Лендинг не может быть указан в тесте дважды');
    }
    const totalWeight = members.reduce((sum, m) => sum + m.weight, 0);
    if (totalWeight !== 100) {
      throw new BadRequestException('Сумма процентов должна быть равна 100');
    }

    const landings = await this.prisma.landing.findMany({ where: { id: { in: ids } } });
    if (landings.length !== ids.length) {
      throw new BadRequestException('Один или несколько лендингов не найдены');
    }
    for (const landing of landings) {
      if (landing.projectId !== projectId) {
        throw new BadRequestException('Все лендинги теста должны принадлежать одному проекту');
      }
      if (landing.abTestGroupId) {
        throw new BadRequestException(`Лендинг «${landing.name}» уже участвует в другом тесте`);
      }
    }
  }

  // Список активных тестов проекта (запрос пользователя 2026-07-17) — раньше группа была
  // видна только косвенно, бейджем на карточке лендинга-участника, без отдельного места, где
  // можно её найти и взять именно её ссылку.
  async listAbTestGroups(projectId: string) {
    return this.prisma.abTestGroup.findMany({
      where: { projectId, deletedAt: null },
      include: { landings: { select: { id: true, name: true, abTestWeight: true }, orderBy: { name: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Company-wide список групп — тот же переключатель "обычные лендинги / группы", что и на
  // company-wide /landings (запрос пользователя 2026-08-20: "добавь этот список груп и на
  // странице всех лендингов"). Видимость — по AB_TESTS_VIEW (та же проверка, что уже применяет
  // project-scoped listAbTestGroups через контроллер), не через landingsVisibilityScope: у
  // группы нет своего createdById/"OWN_GROUPS"-концепции, только реальный проектный грант.
  async findAllGroupsForCompany(companyId: string, userId: string, role: UserRole) {
    const projectIds = await this.projectsService.getAccessibleProjectIds(companyId, userId, role, Permission.AB_TESTS_VIEW);
    if (!projectIds.length) return [];
    return this.prisma.abTestGroup.findMany({
      where: { projectId: { in: projectIds }, companyId, deletedAt: null },
      include: {
        landings: { select: { id: true, name: true, abTestWeight: true }, orderBy: { name: 'asc' } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAbTestGroup(projectId: string, companyId: string, dto: CreateAbTestGroupDto): Promise<AbTestGroup> {
    await this.assertValidMembers(projectId, dto.members);

    return this.prisma.$transaction(async (tx) => {
      const group = await tx.abTestGroup.create({ data: { projectId, companyId, name: dto.name } });
      for (const m of dto.members) {
        await tx.landing.update({ where: { id: m.landingId }, data: { abTestGroupId: group.id, abTestWeight: m.weight } });
      }
      return group;
    });
  }

  async getAbTestGroupProjectId(groupId: string): Promise<string> {
    const group = await this.prisma.abTestGroup.findFirst({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Группа A/B-теста не найдена');
    return group.projectId;
  }

  // Запрос пользователя 2026-08-20: "после создания группы лэндингов для тестирования, уже
  // нельзя будет их менять, так как статистика будет неверной" — состав/веса теста фиксируются
  // раз и навсегда при создании (createAbTestGroup выше). Единственное, что здесь можно
  // изменить, — название (см. UpdateAbTestGroupDto), поэтому больше нет ни assertValidMembers,
  // ни транзакции с перепривязкой лендингов.
  async updateAbTestGroup(groupId: string, dto: UpdateAbTestGroupDto): Promise<AbTestGroup> {
    const group = await this.prisma.abTestGroup.findFirst({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Группа A/B-теста не найдена');
    return this.prisma.abTestGroup.update({ where: { id: groupId }, data: { name: dto.name } });
  }

  // Статистика ОДНОГО участника теста ДЛЯ ЗАСТЫВШЕГО СНЭПШОТА (запрос пользователя 2026-07-17:
  // "хотелось бы куда-то сохранять стату за период теста") — отдельно от computeLandingStats
  // (та считает "всё время жизни лендинга"). Строго трафик, пришедший через сплит ЭТОЙ группы
  // (запрос пользователя 2026-08-20, тот же фильтр, что и у computeAbTestGroupMemberStats), не
  // просто "после старта теста" — та более ранняя версия ещё приплюсовывала любой отдельный
  // трафик лендинга-участника после этой даты. Компактно — без daily-массивов/attachment, не
  // нужны для застывшего снэпшота.
  private async computeAbTestMemberSnapshot(landingId: string, projectId: string, groupId: string, weight: number | null) {
    const [subscribes, pageViews, leads, dialogues] = await Promise.all([
      this.prisma.client.count({ where: { landingId, abTestGroupId: groupId, deletedAt: null } }),
      this.prisma.trackingEvent.count({
        where: {
          projectId,
          eventName: 'PageView',
          AND: [{ payload: { path: ['landingId'], equals: landingId } }, { payload: { path: ['abTestGroupId'], equals: groupId } }],
        },
      }),
      this.prisma.trackingEvent.count({
        where: {
          projectId,
          eventName: 'Lead',
          AND: [{ payload: { path: ['landingId'], equals: landingId } }, { payload: { path: ['abTestGroupId'], equals: groupId } }],
        },
      }),
      this.prisma.client.count({ where: { landingId, abTestGroupId: groupId, deletedAt: null, firstDialogueAt: { not: null } } }),
    ]);
    return { pageViews, leads, subscribes, dialogues, weight };
  }

  // Остановка теста (запрос пользователя 2026-07-17) — раньше сразу soft-delete'ила группу,
  // статистика нигде не сохранялась. Теперь сначала считает застывший снэпшот по каждому
  // участнику (с начала теста), пишет его + endedAt — deletedAt больше НЕ трогает здесь,
  // группа остаётся видна в истории до явного удаления (deleteAbTestGroupHistory).
  async stopAbTestGroup(groupId: string): Promise<void> {
    const group = await this.prisma.abTestGroup.findFirst({ where: { id: groupId }, include: { landings: true } });
    if (!group) throw new NotFoundException('Группа A/B-теста не найдена');

    const resultsSnapshot = await Promise.all(
      group.landings.map(async (l) => ({
        landingId: l.id,
        name: l.name,
        ...(await this.computeAbTestMemberSnapshot(l.id, group.projectId, groupId, l.abTestWeight)),
      })),
    );

    await this.prisma.$transaction([
      this.prisma.landing.updateMany({ where: { abTestGroupId: groupId }, data: { abTestGroupId: null, abTestWeight: null } }),
      // Путь, указывающий на саму группу, стал бы вести в никуда после остановки — все
      // участники теряют abTestGroupId выше, LandingRendererService.pickAbTestGroupVariant
      // нашёл бы 0 живых участников и отдавал 404 навсегда. Освобождаем домен/путь для новой
      // привязки, а не оставляем мёртвую ссылку.
      this.prisma.domainPath.deleteMany({ where: { abTestGroupId: groupId } }),
      this.prisma.abTestGroup.update({
        where: { id: groupId },
        data: { endedAt: new Date(), resultsSnapshot: resultsSnapshot as unknown as Prisma.InputJsonValue },
      }),
    ]);
  }

  // Настоящее удаление завершённого теста из истории (запрос пользователя 2026-07-17) — только
  // для уже остановленных (endedAt задан); действующий тест сначала нужно завершить.
  async deleteAbTestGroupHistory(groupId: string): Promise<void> {
    const group = await this.prisma.abTestGroup.findFirst({ where: { id: groupId, deletedAt: null } });
    if (!group) throw new NotFoundException('Тест не найден');
    if (!group.endedAt) throw new BadRequestException('Сначала завершите тест');
    await this.prisma.abTestGroup.update({ where: { id: groupId }, data: { deletedAt: new Date() } });
  }

  // Своя аватарка лендинга (запрос пользователя 2026-07-04) — переопределяет фото канала
  // (Landing.avatarKey отдельно от templateData.CHANNEL_AVATAR, см. схему). Ключ в MinIO —
  // тот же бакет, что и у ZIP-лендингов (StorageService), префикс landing-avatars/.
  async uploadAvatar(id: string, companyId: string, file: Express.Multer.File): Promise<Landing> {
    if (!file) throw new BadRequestException('Файл не передан');
    if (file.size > MAX_AVATAR_SIZE) throw new BadRequestException('Максимальный размер файла — 5MB');

    const landing = await this.findOne(id, companyId);
    const key = `landing-avatars/${landing.id}/${Date.now()}-${file.originalname.replace(/[^\w.-]/g, '_')}`;
    await this.storage.uploadBuffer(key, file.buffer, file.mimetype || 'image/jpeg');

    if (landing.avatarKey) await this.storage.removeObject(landing.avatarKey);

    return this.prisma.landing.update({ where: { id }, data: { avatarKey: key } });
  }

  async removeAvatar(id: string, companyId: string): Promise<Landing> {
    const landing = await this.findOne(id, companyId);
    if (landing.avatarKey) await this.storage.removeObject(landing.avatarKey);
    return this.prisma.landing.update({ where: { id }, data: { avatarKey: null } });
  }

  // Публичный (без companyId) — используется и самим рендером лендинга (<img src>, посетитель
  // не авторизован), и дашбордом (для превью в редакторе — проще один публичный урл, чем
  // повторять blob-фетч-паттерн ChannelAvatar только ради этого места). Ничего секретного не
  // отдаёт: либо своя загруженная картинка, либо то же фото канала, что уже видно всем
  // подписчикам канала.
  async streamAvatar(id: string, res: Response): Promise<void> {
    const landing = await this.prisma.landing.findFirst({
      where: { id, deletedAt: null },
      select: { avatarKey: true, project: { select: { channel: true } } },
    });
    if (!landing) {
      res.status(404).end();
      return;
    }

    if (landing.avatarKey) {
      try {
        const stream = await this.storage.getObjectStream(landing.avatarKey);
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        stream.on('error', () => {
          if (!res.headersSent) res.status(404).end();
        });
        stream.pipe(res);
        return;
      } catch {
        // Объект мог пропасть из MinIO — падаем на фолбэк канала ниже, а не 404 сразу.
      }
    }

    // Фолбэк — фото канала ("изначально как в канале"), то же самое, что видят подписчики
    // канала в Telegram. Content-Type принудительно 'image/jpeg', не result.contentType —
    // сырой файловый сервер Telegram реально отдаёт 'application/octet-stream' для фото
    // (проверено живьём), хотя это всегда JPEG (big_file_id канала/бота).
    if (landing.project.channel) {
      const result = await this.channelsService.fetchTelegramAvatarBuffer(landing.project.channel);
      if (result) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(result.buffer);
        return;
      }
    }

    res.status(404).end();
  }
}
