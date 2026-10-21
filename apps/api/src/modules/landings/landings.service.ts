import { randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AbTestGroup, CloakingConditionField, Landing, LandingsActionScope, LandingStatus, Permission, Prisma, UserRole } from '@prisma/client';
import { isElevatedRole } from '../../common/permissions/permission.constants';
import { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { dailyBucketSql } from '../../common/timezone.util';
import { TelegramProvider } from '../channels/providers/telegram.provider';
import { ChannelsService } from '../channels/channels.service';
import { VideoProcessingService } from '../channels/video-processing.service';
import { ProjectsService } from '../projects/projects.service';
import { StorageService } from './storage.service';
import { CreateLandingFromTemplateDto } from './dto/create-landing-from-template.dto';
import { UploadCustomLandingDto } from './dto/upload-custom-landing.dto';
import { UpdateLandingDto } from './dto/update-landing.dto';
import { AbTestMemberDto, CreateAbTestGroupDto, UpdateAbTestGroupDto } from './dto/ab-test-group.dto';
import { LandingReviewCheck, reviewLandingHtml, summarizeFailedChecks, hasTrackedJoinButton } from './landing-review.util';
import { isGameTemplate } from './game.util';
import { BUILDER_TEMPLATE_ID, resolveBuilderConfig, validateBuilderConfig } from './builder.util';
import { PUCK_TEMPLATE_ID, validatePuckContent } from './puck.util';
import { AGE_GATE_TEMPLATE_ID } from './extra-popup.util';
import { COUNTDOWN_TEMPLATE_ID } from './countdown.util';
import { CreateExternalLandingDto } from './dto/create-external-landing.dto';
import { CreateCloakingRuleDto, UpdateCloakingRuleDto } from './dto/cloaking-rule.dto';
import { CloakingLogsQueryDto } from './dto/cloaking-logs-query.dto';
import { fetchPublicHtml } from '../../common/safe-html-fetch.util';
import { resolveParamMap } from '../tracking/link-params.const';

const MAX_ZIP_SIZE = 50 * 1024 * 1024;
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
const PUCK_ASSET_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
};
const MAX_PUCK_VIDEO_SIZE = 50 * 1024 * 1024;

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
  // Ограничение видимости по компании (запрос пользователя 2026-09-27: "сделай их доступными
  // пока только для команды isabella") — отсутствие поля = виден всем компаниям, как и раньше.
  // Отфильтровывается в getTemplates() ДО отправки на фронтенд (не просто скрывается в UI) —
  // компания, которой шаблон не разрешён, вообще не видит его в GET /landings/templates и не
  // может получить его превью; assertTemplateAllowed ниже — второй рубеж защиты на создание.
  restrictedToCompanyIds?: string[];
}

// ID компании ISABELA — единственная, кому пока доступен первый реальный шаблон из подборки
// идей вовлечённости (артефакт "Концепты лендингов", 2026-09-25/27: "давай сделаем пока что
// первый, мне понравилась идея"). Не выносится в env/DB — это временное, штучное ограничение
// на один конкретный шаблон, а не общая инфраструктура; если позже понадобится открыть другим
// компаниям или сделать общий механизм фичефлагов на шаблоны — тогда и переносить.
const ISABELA_COMPANY_ID = 'cmrtqcclx0028qwjefprbjdnv';

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
    websiteFaviconUrl: true,
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

export type LandingAction = 'edit' | 'delete';

// Что сотрудник может делать с лендингами — см. LandingsService.resolveActionContext.
export interface LandingActionContext {
  unrestricted: boolean;
  userId: string;
  editScope: LandingsActionScope;
  deleteScope: LandingsActionScope;
  accessProjectIds: Set<string>;
  editProjectIds: Set<string>;
  deleteProjectIds: Set<string>;
}

// Ключ фото фона конструктора внутри builderConfig.background.imageKey.
function currentBuilderImageKey(config: unknown): string | null {
  const key = (config as { background?: { imageKey?: unknown } } | null)?.background?.imageKey;
  return typeof key === 'string' && key.startsWith('landing-builder-bg/') ? key : null;
}

function withBuilderImageKey(config: unknown, imageKey: string | null): Record<string, unknown> {
  const c = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  const background = (c.background && typeof c.background === 'object' ? c.background : {}) as Record<string, unknown>;
  return { ...c, background: { ...background, imageKey } };
}

@Injectable()
export class LandingsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private telegramProvider: TelegramProvider,
    private channelsService: ChannelsService,
    private projectsService: ProjectsService,
    private videoProcessing: VideoProcessingService,
  ) {}

  async getTemplates(companyId: string): Promise<TemplateInfo[]> {
    return this.allTemplates().filter((t) => !t.restrictedToCompanyIds || t.restrictedToCompanyIds.includes(companyId));
  }

  // Второй рубеж защиты (тот же принцип, что PAID_CLOAKING_FIELDS/TRIAL_ALLOWED_CLOAKING_FIELDS
  // у клоакинга) — на случай прямого запроса к API в обход UI, минуя список из getTemplates().
  // Публичный — используется и здесь (создание лендинга), и LandingsController.templatePreview
  // (тот дёргает LandingRendererService напрямую, минуя остальные методы этого сервиса).
  assertTemplateAllowed(templateId: string, companyId: string): void {
    const template = this.allTemplates().find((t) => t.id === templateId);
    if (template?.restrictedToCompanyIds && !template.restrictedToCompanyIds.includes(companyId)) {
      throw new NotFoundException('Шаблон не найден');
    }
  }

  private allTemplates(): TemplateInfo[] {
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
      // Первый из шести концептов вовлечённости, показанных пользователю в качестве примеров
      // 2026-09-25 (артефакт "Концепты лендингов", не связан с продуктом) — превращён в реальный
      // шаблон 2026-09-27 по запросу ("сделай пока что первый, мне понравилась идея"), временно
      // доступен только компании ISABELA (restrictedToCompanyIds). Обычная карточка канала (та же
      // структура, что tg-invite-dark — аватар/название/подписчики/описание/кнопка), плюс новый
      // блок "дефицита времени" сверху: таймер стартует от COUNTDOWN_MINUTES при КАЖДОМ заходе
      // (не от общего для всех дедлайна — так честнее и не ломается для посетителя, зашедшего
      // после "истечения" общего таймера), прогресс-бар и текст об ограниченных местах.
      {
        id: 'countdown-urgency',
        name: 'Обратный отсчёт',
        description: 'Карточка канала с таймером "доступ закроется через..." и текстом об ограниченном числе мест — таймер стартует заново при каждом заходе',
        previewUrl: `${process.env.CDN_URL}/templates/countdown-urgency/preview.jpg`,
        customizableFields: ['LOCK_TEXT', 'SPOTS_TEXT', 'COUNTDOWN_MINUTES', 'JOIN_BUTTON_TEXT'],
        restrictedToCompanyIds: [ISABELA_COMPANY_ID],
      },
      // Игровые лендинги с подарком (запрос пользователя 2026-10-18) — одна общая вёрстка
      // (templates/game), отличается только игра. Все тексты и призы — в Landing.gameConfig,
      // см. game.util.ts.
      {
        id: 'game-wheel',
        name: 'Колесо подарков',
        description: 'Посетитель крутит колесо и получает подарок — сектор выигрыша задаёте вы',
        previewUrl: `${process.env.CDN_URL}/templates/game/preview.jpg`,
        customizableFields: ['JOIN_BUTTON_TEXT', 'GAME_CONFIG'],
      },
      {
        id: 'game-scratch',
        name: 'Стиралка',
        description: 'Карточка, которую стирают пальцем, под ней подарок',
        previewUrl: `${process.env.CDN_URL}/templates/game/preview.jpg`,
        customizableFields: ['JOIN_BUTTON_TEXT', 'GAME_CONFIG'],
      },
      {
        id: 'game-boxes',
        name: 'Три коробки',
        description: 'Посетитель выбирает одну из трёх коробок, подарок есть в каждой',
        previewUrl: `${process.env.CDN_URL}/templates/game/preview.jpg`,
        customizableFields: ['JOIN_BUTTON_TEXT', 'GAME_CONFIG'],
      },
      {
        id: 'game-quiz',
        name: 'Мини-опрос',
        description: '1–3 коротких вопроса, в конце подарок',
        previewUrl: `${process.env.CDN_URL}/templates/game/preview.jpg`,
        customizableFields: ['JOIN_BUTTON_TEXT', 'GAME_CONFIG'],
      },
      // Конструктор (запрос баеров 2026-10-20): фон, вид окна, вопросы и кнопки с действиями
      // настраиваются в Landing.builderConfig — см. builder.util.ts.
      {
        id: BUILDER_TEMPLATE_ID,
        name: 'Конструктор',
        description: 'Свой фон, вопросы и кнопки: окно в стиле iOS или крупный экран',
        previewUrl: '',
        customizableFields: ['BUILDER_CONFIG'],
      },
      // Визуальный редактор Puck (2026-10-21) — страница целиком собирается из блоков, см. puck.util.ts.
      // В галерее шаблонов не показывается: у него своя страница редактора.
      {
        id: PUCK_TEMPLATE_ID,
        name: 'Визуальный редактор',
        description: 'Страница из блоков: секции, колонки, шаги, попапы, кнопки',
        previewUrl: '',
        customizableFields: ['PUCK'],
      },
    ];
  }

  // companyId приходит из контекста авторизации (контроллер передаёт его явно),
  // не из тела запроса — в доке dto.companyId был полем DTO, что позволяло бы
  // клиенту указать ЧУЖОЙ companyId и создать лендинг не в своей компании.
  // createdById — запрос пользователя 2026-08-03, тот же паттерн, что уже есть у
  // Purchase.registeredBy (кто выполнил действие, опционально).
  async createFromTemplate(projectId: string, companyId: string, dto: CreateLandingFromTemplateDto, createdById?: string): Promise<Landing> {
    this.assertTemplateAllowed(dto.templateId, companyId);
    this.assertExtraPopupAllowed(dto.templateId, dto.extraPopupEnabled);
    this.assertBuilderConfigValid(dto.builderConfig);
    this.assertCountdownAllowed(dto.templateId, dto.countdownEnabled);
    if (dto.templateId === PUCK_TEMPLATE_ID) this.assertPuckContentValid(dto.puckData, dto.puckHtml);

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
          JOIN_BUTTON_TEXT: dto.buttonText || (isGameTemplate(dto.templateId) ? 'Unirme al canal' : 'Вступить в канал'),
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
          // countdown-urgency (запрос пользователя 2026-09-27) — дефолты совпадают с тем, что
          // было в исходном макете-концепте (артефакт "Концепты лендингов").
          LOCK_TEXT: dto.lockText || '🔒 Доступ закроется через',
          SPOTS_TEXT: dto.spotsText || '🔥 Осталось 14 мест из 50',
          COUNTDOWN_MINUTES: dto.countdownMinutes || '167',
        },
        metaTitle: dto.metaTitle,
        metaDescription: dto.metaDescription,
        status: LandingStatus.DRAFT,
        autoRedirect: dto.autoRedirect,
        cloakingEnabled: dto.cloakingEnabled,
        leadOnClick: dto.leadOnClick,
        leadOnAutoRedirect: dto.leadOnAutoRedirect,
        tiktokBrowserHint: dto.tiktokBrowserHint,
        tiktokHintTexts: dto.tiktokHintTexts === undefined ? undefined : (dto.tiktokHintTexts as Prisma.InputJsonValue | null),
        extraPopupEnabled: dto.extraPopupEnabled,
        extraPopupConfig: dto.extraPopupConfig === undefined ? undefined : (dto.extraPopupConfig as Prisma.InputJsonValue | null),
        countdownEnabled: dto.countdownEnabled,
        countdownConfig: dto.countdownConfig === undefined ? undefined : (dto.countdownConfig as Prisma.InputJsonValue | null),
        gameConfig: dto.gameConfig === undefined ? undefined : dto.gameConfig === null ? Prisma.JsonNull : (dto.gameConfig as unknown as Prisma.InputJsonValue),
        builderConfig: dto.builderConfig ? (withBuilderImageKey(resolveBuilderConfig(dto.builderConfig), null) as Prisma.InputJsonValue) : undefined,
      },
    });
    // Автопубликация (запрос пользователя 2026-08-20: "при создании лэндинга он автоматом
    // должен быть включен") — раньше лендинг создавался DRAFT и оставался невидимым в трекинге,
    // пока пользователь не нажмёт "Опубликовать" отдельно; через publish(), а не голое
    // status: PUBLISHED в create() выше, чтобы не терять существующую логику первой публикации
    // (создание персональной invite-ссылки для PRIVATE_CHANNEL_REQUEST-атрибуции, см. publish()).
    if (dto.templateId === PUCK_TEMPLATE_ID) await this.savePuckContent(created.id, dto.puckData!, dto.puckHtml!);
    return this.publish(created.id, companyId);
  }

  // ---- Кто что может делать с лендингом (запрос пользователя 2026-10-13) ----
  // Право складывается из двух источников, достаточно любого:
  //  1) per-project LANDINGS_EDIT/LANDINGS_DELETE на проекте лендинга (как было всегда);
  //  2) общая для сотрудника область User.landingsEditScope/landingsDeleteScope — те же три
  //     категории, что у видимости списка: свои (createdById) → + лендинги доступных проектов
  //     (ProjectAccess) → + все лендинги компании. Накопительно.
  // "Свои" определяется только авторством, как и OWN_LANDINGS в видимости — строка таблицы
  // прав означает один и тот же набор лендингов и в "видит", и в "изменяет/удаляет".
  // Контекст считается один раз на запрос и применяется к любому числу лендингов.
  async resolveActionContext(userId: string, role: UserRole): Promise<LandingActionContext> {
    if (isElevatedRole(role)) {
      return { unrestricted: true, userId, editScope: 'ALL', deleteScope: 'ALL', accessProjectIds: new Set(), editProjectIds: new Set(), deleteProjectIds: new Set() };
    }
    const [user, access, grants] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { landingsEditScope: true, landingsDeleteScope: true } }),
      this.prisma.projectAccess.findMany({ where: { userId }, select: { projectId: true } }),
      this.prisma.userPermission.findMany({
        where: { userId, permission: { in: [Permission.LANDINGS_EDIT, Permission.LANDINGS_DELETE] } },
        select: { projectId: true, permission: true },
      }),
    ]);
    const accessProjectIds = new Set(access.map((a) => a.projectId));
    // Грант без ProjectAccess не считается — то же условие, что в ProjectsService.assertAccess.
    const withAccess = grants.filter((g) => accessProjectIds.has(g.projectId));
    return {
      unrestricted: false,
      userId,
      editScope: user?.landingsEditScope ?? 'NONE',
      deleteScope: user?.landingsDeleteScope ?? 'NONE',
      accessProjectIds,
      editProjectIds: new Set(withAccess.filter((g) => g.permission === Permission.LANDINGS_EDIT).map((g) => g.projectId)),
      deleteProjectIds: new Set(withAccess.filter((g) => g.permission === Permission.LANDINGS_DELETE).map((g) => g.projectId)),
    };
  }

  canPerform(action: LandingAction, landing: { projectId: string; createdById: string | null }, ctx: LandingActionContext): boolean {
    if (ctx.unrestricted) return true;
    if ((action === 'edit' ? ctx.editProjectIds : ctx.deleteProjectIds).has(landing.projectId)) return true;
    const scope = action === 'edit' ? ctx.editScope : ctx.deleteScope;
    if (scope === 'ALL') return true;
    if (scope === 'PROJECTS' && ctx.accessProjectIds.has(landing.projectId)) return true;
    if (scope !== 'NONE' && !!landing.createdById && landing.createdById === ctx.userId) return true;
    return false;
  }

  // Флаги для кнопок в списках — считает та же canPerform, что и реальная проверка в
  // контроллере, поэтому кнопка и 403 не могут разойтись.
  async withActionFlags<T extends { projectId: string; createdById: string | null }>(
    landings: T[],
    userId: string,
    role: UserRole,
  ): Promise<(T & { canEdit: boolean; canDelete: boolean })[]> {
    const ctx = await this.resolveActionContext(userId, role);
    return landings.map((l) => ({ ...l, canEdit: this.canPerform('edit', l, ctx), canDelete: this.canPerform('delete', l, ctx) }));
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
    this.assertExtraPopupAllowed(landing.templateId, dto.extraPopupEnabled);
    this.assertBuilderConfigValid(dto.builderConfig);
    this.assertCountdownAllowed(landing.templateId, dto.countdownEnabled);
    const puckTouched = dto.puckData !== undefined || dto.puckHtml !== undefined;
    if (puckTouched) {
      if (landing.templateId !== PUCK_TEMPLATE_ID) throw new BadRequestException('Этот лендинг создан не в визуальном редакторе');
      this.assertPuckContentValid(dto.puckData, dto.puckHtml);
      await this.savePuckContent(landing.id, dto.puckData!, dto.puckHtml!);
    }

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
    if (dto.lockText !== undefined) templateDataPatch.LOCK_TEXT = dto.lockText;
    if (dto.spotsText !== undefined) templateDataPatch.SPOTS_TEXT = dto.spotsText;
    if (dto.countdownMinutes !== undefined) templateDataPatch.COUNTDOWN_MINUTES = dto.countdownMinutes;

    return this.prisma.landing.update({
      where: { id },
      data: {
        name: dto.name,
        metaTitle: dto.metaTitle,
        metaDescription: dto.metaDescription,
        templateData: { ...existingData, ...templateDataPatch } as Prisma.InputJsonValue,
        autoRedirect: dto.autoRedirect,
        cloakingEnabled: dto.cloakingEnabled,
        leadOnClick: dto.leadOnClick,
        leadOnAutoRedirect: dto.leadOnAutoRedirect,
        tiktokBrowserHint: dto.tiktokBrowserHint,
        tiktokHintTexts: dto.tiktokHintTexts === undefined ? undefined : (dto.tiktokHintTexts as Prisma.InputJsonValue | null),
        extraPopupEnabled: dto.extraPopupEnabled,
        extraPopupConfig: dto.extraPopupConfig === undefined ? undefined : (dto.extraPopupConfig as Prisma.InputJsonValue | null),
        countdownEnabled: dto.countdownEnabled,
        countdownConfig: dto.countdownConfig === undefined ? undefined : (dto.countdownConfig as Prisma.InputJsonValue | null),
        gameConfig: dto.gameConfig === undefined ? undefined : dto.gameConfig === null ? Prisma.JsonNull : (dto.gameConfig as unknown as Prisma.InputJsonValue),
        // Ключ фото фона ставит только загрузка файла — из запроса его не берём, сохраняем текущий.
        builderConfig:
          dto.builderConfig === undefined
            ? undefined
            : dto.builderConfig === null
              ? Prisma.JsonNull
              : (withBuilderImageKey(resolveBuilderConfig(dto.builderConfig), currentBuilderImageKey(landing.builderConfig)) as Prisma.InputJsonValue),
      },
    });
  }

  // Дополнительный попап (запрос клиентов 2026-10-02) доступен любому лендингу, КРОМЕ шаблона
  // age-gate-invite: у него такой попап уже встроен в собственный template.html, и второй поверх
  // него был бы дублем того же вопроса. Отказ, а не молчаливое игнорирование: иначе переключатель
  // в UI выглядел бы включённым, а на странице ничего бы не менялось.
  private assertPuckContentValid(data: unknown, html: unknown): void {
    const error = validatePuckContent(data, html);
    if (error) throw new BadRequestException(error);
  }

  private async savePuckContent(landingId: string, data: Record<string, unknown>, html: string): Promise<void> {
    await this.prisma.landingPuckContent.upsert({
      where: { landingId },
      create: { landingId, data: data as Prisma.InputJsonValue, html },
      update: { data: data as Prisma.InputJsonValue, html },
    });
  }

  // Состояние редактора — только для страницы редактора, в списки и GET :id не попадает.
  async getPuckContent(id: string, companyId: string): Promise<{ data: unknown }> {
    const landing = await this.findOne(id, companyId);
    if (landing.templateId !== PUCK_TEMPLATE_ID) throw new BadRequestException('Этот лендинг создан не в визуальном редакторе');
    const content = await this.prisma.landingPuckContent.findUnique({ where: { landingId: id }, select: { data: true } });
    return { data: content?.data ?? null };
  }

  private assertBuilderConfigValid(config: unknown): void {
    if (config === undefined || config === null) return;
    const error = validateBuilderConfig(config);
    if (error) throw new BadRequestException(error);
  }

  private assertExtraPopupAllowed(templateId: string | null | undefined, extraPopupEnabled?: boolean): void {
    if (extraPopupEnabled && templateId === AGE_GATE_TEMPLATE_ID) {
      throw new BadRequestException('У шаблона «Проверка возраста + приглашение» такой попап уже есть — дополнительный здесь не нужен');
    }
    if (extraPopupEnabled && templateId === BUILDER_TEMPLATE_ID) {
      throw new BadRequestException('В конструкторе вопросы настраиваются в самом лендинге — дополнительный попап не нужен');
    }
    if (extraPopupEnabled && templateId === PUCK_TEMPLATE_ID) {
      throw new BadRequestException('В визуальном редакторе попап добавляется блоком «Попап»');
    }
  }

  // Таймер обратного отсчёта (запрос пользователя 2026-10-02) доступен любому лендингу, КРОМЕ
  // шаблона countdown-urgency: там таймер уже внутри собственной вёрстки, второй сверху был бы
  // дублем. Та же логика и тот же способ отказа, что у assertExtraPopupAllowed выше.
  private assertCountdownAllowed(templateId: string | null | undefined, countdownEnabled?: boolean): void {
    if (countdownEnabled && templateId === COUNTDOWN_TEMPLATE_ID) {
      throw new BadRequestException('У этого шаблона таймер уже встроен — отдельный здесь не нужен');
    }
    if (countdownEnabled && templateId === BUILDER_TEMPLATE_ID) {
      throw new BadRequestException('Таймер в конструкторе пока недоступен');
    }
    if (countdownEnabled && templateId === PUCK_TEMPLATE_ID) {
      throw new BadRequestException('В визуальном редакторе таймер добавляется блоком «Таймер»');
    }
  }

  // Создать новый CUSTOM-лендинг сразу из ZIP — отдельно от createFromTemplate,
  // чтобы в UI не нужен был промежуточный "создать пустой лендинг, потом загрузить в него ZIP".
  async createCustom(
    projectId: string,
    companyId: string,
    dto: UploadCustomLandingDto,
    file: Express.Multer.File,
    createdById?: string,
  ): Promise<{ landing: Landing; checks: LandingReviewCheck[] }> {
    const landing = await this.prisma.landing.create({
      data: { projectId, companyId, createdById, name: dto.name, type: 'CUSTOM', status: LandingStatus.DRAFT },
    });
    return this.processAndReviewZip(landing, file, companyId);
  }

  // Перезалить ZIP в существующий лендинг (первая загрузка переводит его в CUSTOM,
  // повторная — заменяет файлы, например при TEMPLATE → CUSTOM миграции или правке вёрстки).
  // Проходит через тот же review-гейт, что и первая загрузка (запрос пользователя 2026-09-07:
  // "дать статус активен... потом уже закончить создание") — уже ПУБЛИКОВАННЫЙ лендинг может
  // вернуться в DRAFT, если замененный архив не проходит проверку. Это осознанное поведение:
  // до этой правки перезаливка вообще не трогала статус, даже если новый архив был битым.
  async uploadCustomLanding(id: string, companyId: string, file: Express.Multer.File): Promise<{ landing: Landing; checks: LandingReviewCheck[] }> {
    const landing = await this.findOne(id, companyId);
    return this.processAndReviewZip(landing, file, companyId);
  }

  // Общая структурная валидация ZIP (расширение/размер/читаемость/zip-slip/наличие index.html)
  // — одинаково жёсткая (hard-fail) и для основного CUSTOM-контента, и для белой страницы
  // клоакинга (запрос пользователя 2026-09-23) — вынесено, чтобы не дублировать. "Судьба"
  // результата (заливать сразу и публиковать позже / отклонить целиком при провале review)
  // остаётся разной, см. processAndReviewZip vs uploadCloakingPrelanding ниже.
  private openLandingZip(file: Express.Multer.File): { zip: AdmZip; entryNames: Set<string>; indexHtml: string; rootPrefix: string } {
    if (!file) throw new BadRequestException('Файл не передан');
    if (!file.originalname.toLowerCase().endsWith('.zip') && file.mimetype !== 'application/zip') {
      throw new BadRequestException('Только ZIP-файлы');
    }
    if (file.size > MAX_ZIP_SIZE) {
      throw new BadRequestException('Максимальный размер ZIP — 50MB');
    }

    let zip: AdmZip;
    try {
      zip = new AdmZip(file.buffer);
    } catch {
      throw new BadRequestException('Не удалось прочитать ZIP-архив');
    }

    // Защита от zip-slip помимо встроенной в adm-zip (>=0.5.2) — не доверяем единственному
    // слою защиты при работе с файлами, загруженными произвольным пользователем.
    const entries = zip.getEntries();
    for (const entry of entries) {
      if (entry.entryName.includes('..') || path.isAbsolute(entry.entryName)) {
        throw new BadRequestException('Архив содержит недопустимые пути');
      }
    }

    let rootPrefix = '';
    let indexEntry = entries.find((e) => e.entryName.toLowerCase() === 'index.html');

    // Частая ошибка при упаковке (запрос пользователя 2026-09-23) — зазипована сама папка
    // сайта, а не её содержимое, поэтому index.html лежит на уровень глубже (my-site/index.html).
    // Если index.html нет в истинном корне, но ВСЕ записи архива лежат под одной и той же
    // единственной папкой верхнего уровня — считаем эту папку корнем и ищем index.html в ней.
    // Не срабатывает, если рядом с папкой в архиве есть ещё что-то (тогда "единственной папки"
    // уже нет) — намеренно консервативно, чтобы не гадать в неоднозначных случаях.
    if (!indexEntry) {
      const topLevelNames = new Set(entries.map((e) => e.entryName.split('/')[0]).filter(Boolean));
      if (topLevelNames.size === 1) {
        const [onlyTopLevel] = topLevelNames;
        const candidatePrefix = `${onlyTopLevel}/`;
        const nestedIndex = entries.find((e) => e.entryName.toLowerCase() === `${candidatePrefix}index.html`.toLowerCase());
        if (nestedIndex) {
          rootPrefix = candidatePrefix;
          indexEntry = nestedIndex;
        }
      }
    }

    if (!indexEntry) {
      throw new BadRequestException('ZIP должен содержать index.html в корне архива');
    }

    // Захватываем содержимое ДО извлечения на диск — нужно для review-проверок ниже (структура
    // HTML, {{TG_REDIRECT_URL}}, битые относительные ссылки на файлы архива). Пути в entryNames
    // отдаются УЖЕ без rootPrefix — реальный сайт живёт "как будто" в корне архива, ссылки в
    // index.html (href="style.css") сравниваются именно с такими относительными путями.
    const indexHtml = indexEntry.getData().toString('utf-8');
    const entryNames = new Set(
      entries
        .filter((e) => e.entryName.startsWith(rootPrefix) && e.entryName !== rootPrefix)
        .map((e) => e.entryName.slice(rootPrefix.length)),
    );

    return { zip, entryNames, indexHtml, rootPrefix };
  }

  private async processAndReviewZip(
    landing: Landing,
    file: Express.Multer.File,
    companyId: string,
  ): Promise<{ landing: Landing; checks: LandingReviewCheck[] }> {
    const { zip, entryNames, indexHtml, rootPrefix } = this.openLandingZip(file);
    const extractPath = path.join('/tmp', `landing-${landing.id}-${Date.now()}`);

    let updatedLanding: Landing;
    try {
      zip.extractAllTo(extractPath, true);

      const basePath = `landings/${landing.id}`;
      await this.storage.removePrefix(basePath);
      // rootPrefix непусто, если index.html был обнаружен не в истинном корне архива, а внутри
      // единственной обёрточной папки (см. openLandingZip) — заливаем именно её содержимое.
      await this.storage.uploadDirectory(path.join(extractPath, rootPrefix), basePath);

      updatedLanding = await this.prisma.landing.update({
        where: { id: landing.id },
        data: { type: 'CUSTOM', customBasePath: basePath, templateId: null, templateData: Prisma.JsonNull },
      });
    } finally {
      await fs.rm(extractPath, { recursive: true, force: true }).catch(() => {});
    }

    const checks = reviewLandingHtml(indexHtml, entryNames);
    if (checks.every((c) => c.passed)) {
      // Автопубликация только после реальной проверки (запрос пользователя 2026-09-07) — см.
      // полный комментарий у publish() ниже; до этой правки публикация была безусловной сразу
      // после загрузки (запрос пользователя 2026-08-20).
      updatedLanding = await this.publish(updatedLanding.id, companyId);
    } else {
      updatedLanding = await this.prisma.landing.update({
        where: { id: updatedLanding.id },
        data: { lastError: summarizeFailedChecks(checks) },
      });
    }

    return { landing: updatedLanding, checks };
  }

  // Белая страница для клоакинга типа PRELANDING (запрос пользователя 2026-09-23) — в отличие
  // от processAndReviewZip выше, ЗДЕСЬ провал review — это отказ целиком: ни MinIO, ни БД не
  // трогаются, если хоть один чек не прошёл ("сломаную не пропускаем" — явное требование
  // пользователя, строже, чем поведение для основного контента лендинга, который заливается
  // даже проваленным и просто не публикуется). requireRedirectPlaceholder:false — white page
  // клоакинга не имеет кнопки перехода в Telegram, это decoy-страница.
  async uploadCloakingPrelanding(
    id: string,
    companyId: string,
    file: Express.Multer.File,
  ): Promise<{ accepted: boolean; checks: LandingReviewCheck[] }> {
    const landing = await this.findOne(id, companyId);
    const { zip, entryNames, indexHtml, rootPrefix } = this.openLandingZip(file);

    const checks = reviewLandingHtml(indexHtml, entryNames, { requireRedirectPlaceholder: false });
    if (!checks.every((c) => c.passed)) {
      return { accepted: false, checks };
    }

    const extractPath = path.join('/tmp', `landing-cloak-prelanding-${landing.id}-${Date.now()}`);
    try {
      zip.extractAllTo(extractPath, true);
      // Отдельный от landings/{id} (основной CUSTOM-контент) префикс — оба могут сосуществовать
      // на одном лендинге (TEMPLATE/EXTERNAL-лендинг тоже может иметь клоакинг-предзагрузку).
      const basePath = `landing-cloaking-prelanding/${landing.id}`;
      await this.storage.removePrefix(basePath);
      await this.storage.uploadDirectory(path.join(extractPath, rootPrefix), basePath);
      await this.prisma.landing.update({ where: { id: landing.id }, data: { cloakingPrelandingBasePath: basePath } });
    } finally {
      await fs.rm(extractPath, { recursive: true, force: true }).catch(() => {});
    }

    return { accepted: true, checks };
  }

  async removeCloakingPrelanding(id: string, companyId: string): Promise<Landing> {
    const landing = await this.findOne(id, companyId);
    if (landing.cloakingPrelandingBasePath) {
      await this.storage.removePrefix(landing.cloakingPrelandingBasePath);
    }
    return this.prisma.landing.update({ where: { id }, data: { cloakingPrelandingBasePath: null } });
  }

  // Просмотр/скачивание уже загруженной белой страницы (запрос пользователя 2026-09-25: "добавь
  // возможность скачать zip... скачать html файл или посмотреть его сразу на сайте") — доступны
  // ВСЕГДА, независимо от того, как страница была загружена (ZIP-архивом или вставленным HTML-
  // кодом, см. uploadCloakingPrelanding/uploadCloakingPrelandingHtml выше): оба способа кладут
  // результат под один и тот же cloakingPrelandingBasePath, поэтому "посмотреть"/"скачать HTML"
  // одинаково работают в обоих случаях, а "скачать ZIP" просто архивирует что там реально лежит —
  // один файл (был вставлен HTML) или несколько (был загружен ZIP с ассетами), различать способ
  // загрузки отдельным полем не нужно.
  private async assertPrelandingUploaded(id: string, companyId: string): Promise<Landing> {
    const landing = await this.findOne(id, companyId);
    if (!landing.cloakingPrelandingBasePath) throw new NotFoundException('Белая страница ещё не загружена');
    return landing;
  }

  async renderCloakingPrelandingPreviewHtml(id: string, companyId: string): Promise<string> {
    const landing = await this.assertPrelandingUploaded(id, companyId);
    const buffer = await this.storage.getObjectBuffer(`${landing.cloakingPrelandingBasePath}/index.html`);
    return buffer.toString('utf-8');
  }

  async streamCloakingPrelandingAsset(id: string, companyId: string, subPath: string, res: Response): Promise<void> {
    const landing = await this.findOne(id, companyId);
    if (!landing.cloakingPrelandingBasePath) {
      res.status(404).send('Not found');
      return;
    }
    const key = `${landing.cloakingPrelandingBasePath}/${subPath}`;
    try {
      const stream = await this.storage.getObjectStream(key);
      res.type(path.extname(key) || '.bin');
      stream.on('error', () => {
        if (!res.headersSent) res.status(404).send('Not found');
      });
      stream.pipe(res);
    } catch {
      res.status(404).send('Not found');
    }
  }

  async streamCloakingPrelandingHtmlDownload(id: string, companyId: string, res: Response): Promise<void> {
    const landing = await this.assertPrelandingUploaded(id, companyId);
    const buffer = await this.storage.getObjectBuffer(`${landing.cloakingPrelandingBasePath}/index.html`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="prelanding.html"');
    res.send(buffer);
  }

  async streamCloakingPrelandingZipDownload(id: string, companyId: string, res: Response): Promise<void> {
    const landing = await this.assertPrelandingUploaded(id, companyId);
    const basePath = landing.cloakingPrelandingBasePath as string;
    const keys = await this.storage.listPrefix(basePath);

    const zip = new AdmZip();
    for (const key of keys) {
      const relative = key.slice(basePath.length + 1);
      if (!relative) continue;
      const buffer = await this.storage.getObjectBuffer(key);
      zip.addFile(relative, buffer);
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="prelanding.zip"');
    res.send(zip.toBuffer());
  }

  // Альтернатива ZIP-загрузке (запрос пользователя 2026-09-23: "просто сразу код кидать в поле")
  // — весь HTML одним блоком, без отдельных файлов-ассетов. entryNames пустой Set: ссылки на
  // локальные файлы (href="style.css") у вставленного кода корректно провалят проверку —
  // никаких других файлов не загружалось, у них и не может быть реального адреса. Тот же
  // строгий гейт, что и у ZIP-варианта: провал проверки не пишет вообще ничего.
  async uploadCloakingPrelandingHtml(id: string, companyId: string, html: string): Promise<{ accepted: boolean; checks: LandingReviewCheck[] }> {
    const landing = await this.findOne(id, companyId);

    const checks = reviewLandingHtml(html, new Set(), { requireRedirectPlaceholder: false });
    if (!checks.every((c) => c.passed)) {
      return { accepted: false, checks };
    }

    const basePath = `landing-cloaking-prelanding/${landing.id}`;
    // removePrefix — на случай, если раньше сюда уже заливали ZIP с ассетами: вставленный код
    // заменяет white page целиком, старые файлы не должны остаться висеть рядом с новым index.html.
    await this.storage.removePrefix(basePath);
    await this.storage.uploadBuffer(`${basePath}/index.html`, Buffer.from(html, 'utf-8'), 'text/html');
    await this.prisma.landing.update({ where: { id: landing.id }, data: { cloakingPrelandingBasePath: basePath } });

    return { accepted: true, checks };
  }

  // Платный тир Keitaro-парности (запрос пользователя 2026-09-24) — evaluator для этих типов
  // не реализован (см. CloakingConditionField в schema.prisma), фронтенд показывает их
  // задизейбленными с подписью "скоро будет доступно". Проверка здесь — второй рубеж защиты
  // (defense in depth) на случай прямого запроса к API в обход UI, не единственный.
  private static readonly PAID_CLOAKING_FIELDS: CloakingConditionField[] = ['PROXY', 'ISP', 'MOBILE_OPERATOR', 'CONNECTION_TYPE'];

  // На TRIAL клоакинг доступен только по условию "Страна" (запрос пользователя 2026-09-25: "запрет
  // на все опции клоакинга кроме страны... остальные опции сделай отключенными" — полный доступ
  // ко всем условиям открывается со Starter). Фронтенд задизейблит остальные пункты в Select с
  // тем же значком, что и у тарифа Starter на странице подписки — эта проверка здесь такой же
  // второй рубеж защиты, как и у PAID_CLOAKING_FIELDS выше.
  private static readonly TRIAL_ALLOWED_CLOAKING_FIELDS: CloakingConditionField[] = ['COUNTRY'];

  private async assertCloakingConditionsAllowed(companyId: string, conditions?: { field: CloakingConditionField }[]): Promise<void> {
    if (!conditions?.length) return;

    const paidField = conditions.find((c) => LandingsService.PAID_CLOAKING_FIELDS.includes(c.field));
    if (paidField) {
      throw new BadRequestException(`Тип условия "${paidField.field}" скоро будет доступен`);
    }

    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { plan: true } });
    if (company?.plan === 'TRIAL') {
      const lockedField = conditions.find((c) => !LandingsService.TRIAL_ALLOWED_CLOAKING_FIELDS.includes(c.field));
      if (lockedField) {
        throw new BadRequestException(`Тип условия "${lockedField.field}" доступен начиная с тарифа Starter`);
      }
    }
  }

  // Движок правил клоакинга (запрос пользователя 2026-09-24, "довести до уровня Keitaro") — CRUD
  // правил одного лендинга. Условия правила заменяются ЦЕЛИКОМ при каждом PATCH с переданным
  // conditions (delete+recreate в одной транзакции) — условий на правило всегда немного,
  // диффинг не даёт выгоды и только усложняет код.
  async listCloakingRules(id: string, companyId: string) {
    await this.findOne(id, companyId);
    return this.prisma.cloakingRule.findMany({
      where: { landingId: id },
      orderBy: { position: 'asc' },
      include: { conditions: true },
    });
  }

  async createCloakingRule(id: string, companyId: string, dto: CreateCloakingRuleDto) {
    const landing = await this.findOne(id, companyId);
    await this.assertCloakingConditionsAllowed(companyId, dto.conditions);

    const last = await this.prisma.cloakingRule.findFirst({
      where: { landingId: landing.id },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return this.prisma.cloakingRule.create({
      data: {
        landingId: landing.id,
        name: dto.name,
        position: (last?.position ?? -1) + 1,
        matchLogic: dto.matchLogic,
        action: dto.action,
        actionRedirectUrl: dto.actionRedirectUrl,
        actionCustomHtml: dto.actionCustomHtml,
        actionCustomText: dto.actionCustomText,
        conditions: dto.conditions ? { create: dto.conditions.map((c) => ({ field: c.field, negate: c.negate, config: c.config as Prisma.InputJsonValue })) } : undefined,
      },
      include: { conditions: true },
    });
  }

  private async assertRuleInLanding(landingId: string, companyId: string, ruleId: string): Promise<void> {
    await this.findOne(landingId, companyId);
    const rule = await this.prisma.cloakingRule.findFirst({ where: { id: ruleId, landingId } });
    if (!rule) throw new NotFoundException('Правило клоакинга не найдено');
  }

  async updateCloakingRule(id: string, companyId: string, ruleId: string, dto: UpdateCloakingRuleDto) {
    await this.assertRuleInLanding(id, companyId, ruleId);
    await this.assertCloakingConditionsAllowed(companyId, dto.conditions);

    return this.prisma.$transaction(async (tx) => {
      if (dto.conditions) {
        await tx.cloakingCondition.deleteMany({ where: { ruleId } });
      }
      return tx.cloakingRule.update({
        where: { id: ruleId },
        data: {
          name: dto.name,
          isEnabled: dto.isEnabled,
          matchLogic: dto.matchLogic,
          action: dto.action,
          actionRedirectUrl: dto.actionRedirectUrl,
          actionCustomHtml: dto.actionCustomHtml,
          actionCustomText: dto.actionCustomText,
          conditions: dto.conditions
            ? { create: dto.conditions.map((c) => ({ field: c.field, negate: c.negate, config: c.config as Prisma.InputJsonValue })) }
            : undefined,
        },
        include: { conditions: true },
      });
    });
  }

  async removeCloakingRule(id: string, companyId: string, ruleId: string): Promise<void> {
    await this.assertRuleInLanding(id, companyId, ruleId);
    await this.prisma.cloakingRule.delete({ where: { id: ruleId } });
  }

  async reorderCloakingRules(id: string, companyId: string, ruleIds: string[]): Promise<void> {
    const landing = await this.findOne(id, companyId);
    const existing = await this.prisma.cloakingRule.findMany({ where: { landingId: landing.id }, select: { id: true } });
    const existingIds = new Set(existing.map((r) => r.id));
    if (ruleIds.length !== existing.length || !ruleIds.every((rid) => existingIds.has(rid))) {
      throw new BadRequestException('Список правил не совпадает с текущими правилами лендинга');
    }

    await this.prisma.$transaction(ruleIds.map((ruleId, index) => this.prisma.cloakingRule.update({ where: { id: ruleId }, data: { position: index } })));
  }

  // Журнал заблокированных клоакингом заходов (запрос пользователя 2026-09-25) — записи пишет
  // CloakingService.applyCloaking, читает этот метод. Компания уже проверена через findOne (тот
  // же способ, что и listCloakingRules — CloakingLog не в modelsWithCompany, поэтому scoping
  // ручной через landingId, а не через компанию напрямую). Фильтр по field ищет по JSONB-массиву
  // matchedConditions через EXISTS, а не Prisma.findMany — Prisma не умеет фильтровать "хотя бы
  // один элемент массива объектов, где поле X равно Y" без сырого SQL.
  async listCloakingLogs(id: string, companyId: string, query: CloakingLogsQueryDto) {
    const landing = await this.findOne(id, companyId);
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 25, 100);
    const offset = (page - 1) * limit;

    const conditions: Prisma.Sql[] = [Prisma.sql`"landingId" = ${landing.id}`];
    if (query.ruleId) conditions.push(Prisma.sql`"ruleId" = ${query.ruleId}`);
    if (query.from) conditions.push(Prisma.sql`"createdAt" >= ${new Date(`${query.from}T00:00:00.000Z`)}`);
    if (query.to) {
      const upperBound = new Date(`${query.to}T00:00:00.000Z`);
      upperBound.setUTCDate(upperBound.getUTCDate() + 1);
      conditions.push(Prisma.sql`"createdAt" < ${upperBound}`);
    }
    if (query.field) {
      conditions.push(
        Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements("matchedConditions") elem WHERE elem->>'field' = ${query.field})`,
      );
    }
    const whereSql = Prisma.join(conditions, ' AND ');

    const [rows, totalRows] = await Promise.all([
      this.prisma.$queryRaw<
        { id: string; ruleId: string | null; ruleName: string | null; action: string; matchedConditions: unknown; requestSnapshot: unknown; createdAt: Date }[]
      >`
        SELECT id, "ruleId", "ruleName", action, "matchedConditions", "requestSnapshot", "createdAt"
        FROM "CloakingLog"
        WHERE ${whereSql}
        ORDER BY "createdAt" DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*)::bigint AS count FROM "CloakingLog" WHERE ${whereSql}`,
    ]);

    return { rows, total: Number(totalRows[0]?.count ?? 0), page, limit };
  }

  // Лендинг клиента на ЕГО собственном сервере/домене (запрос пользователя 2026-09-07) — мы его
  // никогда не рендерим (в отличие от TEMPLATE/CUSTOM, см. LandingRendererService.renderAndServe,
  // ветка EXTERNAL там намеренно 404-ит), только принимаем трекинг-события с уже проставленным
  // data-landing-id и проверяем подключение. Без автопубликации (в отличие от createCustom) —
  // верификация отдельное явное действие клиента через verifyExternalLanding ниже.
  async createExternal(projectId: string, companyId: string, dto: CreateExternalLandingDto, createdById?: string): Promise<Landing> {
    return this.prisma.landing.create({
      data: { projectId, companyId, createdById, name: dto.name, type: 'EXTERNAL', status: LandingStatus.DRAFT, externalUrl: dto.externalUrl },
    });
  }

  // "Проверить подключение" — тот же принцип, что WebsiteProvider.initialize() уже применяет к
  // ChannelType.WEBSITE (см. common/safe-html-fetch.util.ts, вынесенный оттуда же), но с
  // дополнительной проверкой data-landing-id — здесь важно подтвердить, что на странице стоит
  // сниппет ИМЕННО этого лендинга, а не просто какой-то сниппет проекта.
  async verifyExternalLanding(id: string, companyId: string): Promise<{ landing: Landing; checks: LandingReviewCheck[] }> {
    const landing = await this.findOne(id, companyId);
    if (landing.type !== 'EXTERNAL' || !landing.externalUrl) {
      throw new BadRequestException('Это не внешний лендинг или у него не указан адрес');
    }

    const project = await this.prisma.project.findUnique({ where: { id: landing.projectId }, include: { channel: true } });
    if (!project) throw new NotFoundException('Проект не найден');

    let html: string | null = null;
    let fetchError: string | null = null;
    try {
      html = await fetchPublicHtml(landing.externalUrl, { userAgent: 'MWTRACK-LandingVerifier/1.0' });
    } catch (error) {
      fetchError = (error as Error).message;
    }

    const cdnUrl = process.env.CDN_URL || '';
    const checks: LandingReviewCheck[] = [
      {
        id: 'page-reachable',
        label: 'Страница доступна',
        passed: html !== null,
        detail: fetchError ?? undefined,
      },
      {
        id: 'script-tag',
        label: 'Скрипт трекинга установлен',
        passed: !!html && !!cdnUrl && html.includes(`${cdnUrl}/track.js`),
        detail: html && (!cdnUrl || !html.includes(`${cdnUrl}/track.js`)) ? 'На странице не найден тег track.js — проверьте, что вставили его целиком.' : undefined,
      },
      {
        id: 'project-id',
        label: 'Скрипт указывает на этот проект',
        passed: !!html && html.includes(`data-project-id="${project.publicToken}"`),
        detail: html && !html.includes(`data-project-id="${project.publicToken}"`) ? 'Тег на странице ссылается на другой проект — скопируйте актуальный сниппет.' : undefined,
      },
      {
        id: 'landing-id',
        label: 'Скрипт указывает на этот лендинг',
        passed: !!html && html.includes(`data-landing-id="${landing.id}"`),
        detail: html && !html.includes(`data-landing-id="${landing.id}"`) ? 'В теге нет data-landing-id этого лендинга — статистика не будет привязываться именно к нему.' : undefined,
      },
    ];

    // Кнопка перехода имеет смысл только для Telegram-режима — у WEBSITE-канала нет /tg-redirect,
    // у него собственный сценарий (переход сразу на сайт), поэтому эту проверку не применяем.
    if (project.channel?.type === 'TELEGRAM') {
      checks.push({
        id: 'join-link',
        label: 'Кнопка перехода в Telegram настроена',
        passed: !!html && html.includes(`/track/${project.publicToken}/tg-redirect`),
        detail: html && !html.includes(`/track/${project.publicToken}/tg-redirect`) ? 'На странице не найдена ссылка на переход в Telegram — проверьте href кнопки.' : undefined,
      });
      // Баг-репорт 2026-09-08: клики по кнопке реально уходили на сервер, но тихо отклонялись —
      // без data-track="Lead" сервер не признаёт название события и отбрасывает его 400-й
      // ошибкой, а SDK не логирует неудачные запросы, поэтому проблема была не видна ни на
      // странице клиента, ни в самой СРМ до ручного разбора. См. hasTrackedJoinButton.
      checks.push({
        id: 'click-tracking',
        label: 'Клик по кнопке трекается как Lead',
        passed: !!html && hasTrackedJoinButton(html, project.publicToken),
        detail:
          html && !hasTrackedJoinButton(html, project.publicToken)
            ? 'На кнопке перехода нет атрибута data-track="Lead" — клики по ней не будут засчитаны в воронке. Добавьте data-track="Lead" на тег <a> с этой ссылкой.'
            : undefined,
      });
    }

    let updatedLanding: Landing;
    if (checks.every((c) => c.passed)) {
      updatedLanding = await this.publish(id, companyId);
    } else {
      updatedLanding = await this.prisma.landing.update({
        where: { id },
        data: { lastError: summarizeFailedChecks(checks) },
      });
    }

    return { landing: updatedLanding, checks };
  }

  // Готовый копируемый тег + ссылка кнопки для конкретного EXTERNAL-лендинга — тот же тег, что
  // ProjectsService.getSnippet() выдаёт для проекта в целом, плюс data-landing-id (запрос
  // пользователя 2026-09-07 — без него события с внешней страницы не привязывались бы именно к
  // этому лендингу, только к проекту).
  async getExternalLandingSnippet(id: string, companyId: string): Promise<{ scriptTag: string; joinButtonHref: string | null }> {
    const landing = await this.findOne(id, companyId);
    if (landing.type !== 'EXTERNAL') {
      throw new BadRequestException('Это не внешний лендинг');
    }

    const project = await this.prisma.project.findUnique({ where: { id: landing.projectId }, include: { channel: true } });
    if (!project) throw new NotFoundException('Проект не найден');

    const apiUrl = `${process.env.API_URL}/api/v1`;
    const paramMapAttr = JSON.stringify(resolveParamMap(project.linkParamMap)).replace(/"/g, '&quot;');
    const scriptTag = `<!-- TrafficCRM Tracking -->
<script src="${process.env.CDN_URL}/track.js"
        data-project-id="${project.publicToken}"
        data-api-url="${apiUrl}"
        data-landing-id="${landing.id}"
        data-param-map="${paramMapAttr}"
        async>
</script>`;

    const joinButtonHref = project.channel?.type === 'TELEGRAM' ? `${apiUrl}/track/${project.publicToken}/tg-redirect` : null;

    return { scriptTag, joinButtonHref };
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
          return this.prisma.landing.update({ where: { id }, data: { status: LandingStatus.PUBLISHED, tgInviteLink: inviteLink, lastError: null } });
        }
      }
    }

    return this.prisma.landing.update({ where: { id }, data: { status: LandingStatus.PUBLISHED, lastError: null } });
  }

  async unpublish(id: string, companyId: string): Promise<Landing> {
    await this.findOne(id, companyId);
    return this.prisma.landing.update({ where: { id }, data: { status: LandingStatus.DRAFT } });
  }

  async remove(id: string, companyId: string): Promise<void> {
    await this.findOne(id, companyId);
    await this.prisma.landing.update({ where: { id }, data: { deletedAt: new Date(), status: LandingStatus.ARCHIVED } });
  }

  // Копия лендинга (запрос клиентов через пользователя 2026-10-02: "а нет возможности лендинг
  // сделать копируемым? чтоб просто домен заменить для следующей ссылки") — весь контент и
  // настройки переносятся как есть, но НАРОЧНО НЕ переносятся: привязка к домену (DomainPath) —
  // ровно то, что клиент и просит заменить на новый, копия стартует без домена; A/B-группа
  // (копия не должна тихо присоединиться к тесту оригинала — abTestGroupId/abTestWeight не
  // копируются); персональная Telegram-invite-ссылка (два лендинга с ОДНОЙ и той же ссылкой
  // сломали бы пер-лендинговую атрибуцию подписчиков — publish() ниже сгенерирует копии свою,
  // свежую); счётчики ботов (новый лендинг без своей истории трафика, стартует с нуля).
  // CUSTOM-контент и белая страница клоакинга — реальные файлы в MinIO, а не просто строка пути
  // в БД: customBasePath/cloakingPrelandingBasePath у обоих лендингов завязаны на их СОБСТВЕННЫЙ
  // landing.id (см. processAndReviewZip/uploadCloakingPrelanding), поэтому физически копируются
  // через StorageService.copyPrefix в новый, свой префикс — иначе оба лендинга делили бы один и
  // тот же MinIO-путь, и перезаливка ZIP у одного стирала бы контент другого. CloakingRule/
  // CloakingCondition — тоже реальные строки БД, копируются целиком с новыми id под новый
  // лендинг, иначе клиенту пришлось бы настраивать фильтрацию заново на каждой копии.
  async duplicate(id: string, companyId: string, createdById?: string): Promise<Landing> {
    const original = await this.findOne(id, companyId);

    const created = await this.prisma.landing.create({
      data: {
        companyId,
        projectId: original.projectId,
        createdById,
        name: `${original.name} (копия)`,
        type: original.type,
        templateId: original.templateId,
        templateData: original.templateData === null ? Prisma.JsonNull : (original.templateData as Prisma.InputJsonValue),
        externalUrl: original.externalUrl,
        metaTitle: original.metaTitle,
        metaDescription: original.metaDescription,
        faviconUrl: original.faviconUrl,
        autoRedirect: original.autoRedirect,
        cloakingEnabled: original.cloakingEnabled,
        leadOnClick: original.leadOnClick,
        leadOnAutoRedirect: original.leadOnAutoRedirect,
        tiktokBrowserHint: original.tiktokBrowserHint,
        tiktokHintTexts: original.tiktokHintTexts === null ? Prisma.JsonNull : (original.tiktokHintTexts as Prisma.InputJsonValue),
        extraPopupEnabled: original.extraPopupEnabled,
        extraPopupConfig: original.extraPopupConfig === null ? Prisma.JsonNull : (original.extraPopupConfig as Prisma.InputJsonValue),
        countdownEnabled: original.countdownEnabled,
        countdownConfig: original.countdownConfig === null ? Prisma.JsonNull : (original.countdownConfig as Prisma.InputJsonValue),
        gameConfig: original.gameConfig === null ? Prisma.JsonNull : (original.gameConfig as Prisma.InputJsonValue),
        // Фото фона копируется ниже в собственный путь копии — здесь ключ пока сбрасываем.
        builderConfig: original.builderConfig === null ? Prisma.JsonNull : (withBuilderImageKey(original.builderConfig, null) as Prisma.InputJsonValue),
        status: LandingStatus.DRAFT,
      },
    });

    // Картинки Puck лежат в общей папке компании (puck-assets) — у копии те же адреса, копировать нечего.
    const puckContent = await this.prisma.landingPuckContent.findUnique({ where: { landingId: id } });
    if (puckContent) {
      await this.prisma.landingPuckContent.create({
        data: { landingId: created.id, data: puckContent.data as Prisma.InputJsonValue, html: puckContent.html },
      });
    }

    if (original.customBasePath) {
      const newBasePath = `landings/${created.id}`;
      await this.storage.copyPrefix(original.customBasePath, newBasePath);
      await this.prisma.landing.update({ where: { id: created.id }, data: { customBasePath: newBasePath } });
    }

    if (original.cloakingPrelandingBasePath) {
      const newPrelandingPath = `landing-cloaking-prelanding/${created.id}`;
      await this.storage.copyPrefix(original.cloakingPrelandingBasePath, newPrelandingPath);
      await this.prisma.landing.update({ where: { id: created.id }, data: { cloakingPrelandingBasePath: newPrelandingPath } });
    }

    const originalBgKey = currentBuilderImageKey(original.builderConfig);
    if (originalBgKey) {
      const newBgKey = `landing-builder-bg/${created.id}/${originalBgKey.split('/').pop()}`;
      await this.storage.copyObject(originalBgKey, newBgKey);
      await this.prisma.landing.update({
        where: { id: created.id },
        data: { builderConfig: withBuilderImageKey(original.builderConfig, newBgKey) as Prisma.InputJsonValue },
      });
    }

    if (original.avatarKey) {
      const fileName = original.avatarKey.split('/').pop();
      const newAvatarKey = `landing-avatars/${created.id}/${fileName}`;
      await this.storage.copyObject(original.avatarKey, newAvatarKey);
      await this.prisma.landing.update({ where: { id: created.id }, data: { avatarKey: newAvatarKey } });
    }

    const rules = await this.prisma.cloakingRule.findMany({
      where: { landingId: id },
      include: { conditions: true },
      orderBy: { position: 'asc' },
    });
    for (const rule of rules) {
      await this.prisma.cloakingRule.create({
        data: {
          landingId: created.id,
          name: rule.name,
          position: rule.position,
          isEnabled: rule.isEnabled,
          matchLogic: rule.matchLogic,
          action: rule.action,
          actionRedirectUrl: rule.actionRedirectUrl,
          actionCustomHtml: rule.actionCustomHtml,
          actionCustomText: rule.actionCustomText,
          conditions: {
            create: rule.conditions.map((c) => ({
              field: c.field,
              negate: c.negate,
              config: c.config as Prisma.InputJsonValue,
            })),
          },
        },
      });
    }

    // EXTERNAL — контент живёт на сервере клиента, копия строки в нашей БД не копирует НИКАКОГО
    // реального контента (в отличие от TEMPLATE/CUSTOM); клиенту ещё только предстоит поставить
    // новый code snippet (со СВОИМ data-landing-id) на новую страницу, поэтому, как и при обычном
    // createExternal, копия остаётся DRAFT до отдельной верификации — автопубликация здесь была
    // бы откровенно лживой (показывала бы "Активен" при реально ещё не подключённой странице).
    if (original.type === 'EXTERNAL') {
      return this.prisma.landing.findUniqueOrThrow({ where: { id: created.id } });
    }

    return this.publish(created.id, companyId);
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
      // Внешние лендинги исключены из A/B/n-тестов (запрос пользователя 2026-09-07) — единая
      // ссылка со случайным сплитом между чужими доменами потребовала бы отдельного
      // редирект-механизма на нашей стороне, от которого пользователь явно отказался.
      if (landing.type === 'EXTERNAL') {
        throw new BadRequestException(`Лендинг «${landing.name}» — внешний, его нельзя добавить в A/B-тест`);
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

  // Картинки визуального редактора Puck (2026-10-21): папка компании, имя случайное, файл неизменяем —
  // поэтому кэш на год. Удаляются только вместе с бакетом: страница может ссылаться на картинку и
  // из копии лендинга, и из старой версии, которую ещё не пересохранили.
  async uploadPuckAsset(companyId: string, file: Express.Multer.File): Promise<{ url: string; type: 'image' | 'video'; posterUrl: string | null }> {
    if (!file) throw new BadRequestException('Файл не передан');
    const mime = file.mimetype || '';
    const base = `${process.env.API_URL}/api/v1/landings/puck-assets/${companyId}`;
    const name = (ext: string) => `${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`;

    // Видео (конструктор, 2026-10-21): любой формат перекодируется в mp4 + кадр-обложка.
    if (mime.startsWith('video/')) {
      if (file.size > MAX_PUCK_VIDEO_SIZE) throw new BadRequestException('Максимальный размер видео — 50MB');
      const { video, poster } = await this.videoProcessing.transcodeForWeb(file.buffer);
      const videoName = name('mp4');
      await this.storage.uploadBuffer(`landing-puck-assets/${companyId}/${videoName}`, video, 'video/mp4');
      let posterUrl: string | null = null;
      if (poster) {
        const posterName = name('jpg');
        await this.storage.uploadBuffer(`landing-puck-assets/${companyId}/${posterName}`, poster, 'image/jpeg');
        posterUrl = `${base}/${posterName}`;
      }
      return { url: `${base}/${videoName}`, type: 'video', posterUrl };
    }

    if (file.size > MAX_AVATAR_SIZE) throw new BadRequestException('Максимальный размер картинки — 5MB');
    const ext = PUCK_ASSET_TYPES[mime];
    if (!ext || ext === 'mp4') throw new BadRequestException('Нужна картинка (JPG, PNG, WEBP, GIF, SVG) или видео');
    const fileName = name(ext);
    await this.storage.uploadBuffer(`landing-puck-assets/${companyId}/${fileName}`, file.buffer, mime);
    return { url: `${base}/${fileName}`, type: 'image', posterUrl: null };
  }

  // Публичная выдача. Видео отдаётся кусками по Range — Safari на iPhone без этого его не играет.
  async streamPuckAsset(companyId: string, file: string, req: Request, res: Response): Promise<void> {
    const ext = /^[0-9]+-[0-9a-f]{12}\.([a-z0-9]+)$/.exec(file)?.[1];
    const type = ext && Object.entries(PUCK_ASSET_TYPES).find(([, e]) => e === ext)?.[0];
    if (!/^[a-z0-9]{10,40}$/.test(companyId) || !type) {
      res.status(404).end();
      return;
    }
    const key = `landing-puck-assets/${companyId}/${file}`;
    try {
      const { size } = await this.storage.statObject(key);
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Accept-Ranges', 'bytes');
      // SVG может содержать скрипт — пусть открывается только как картинка, не как страница.
      if (ext === 'svg') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");

      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
      let stream;
      if (range && (range[1] || range[2])) {
        let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        let end = range[1] && range[2] ? Number(range[2]) : size - 1;
        end = Math.min(end, size - 1);
        if (start > end || start >= size) {
          res.status(416).setHeader('Content-Range', `bytes */${size}`);
          res.end();
          return;
        }
        start = Math.max(0, start);
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', String(end - start + 1));
        stream = await this.storage.getPartialObjectStream(key, start, end - start + 1);
      } else {
        res.setHeader('Content-Length', String(size));
        stream = await this.storage.getObjectStream(key);
      }
      stream.on('error', () => {
        if (!res.headersSent) res.status(404).end();
        else res.end();
      });
      stream.pipe(res);
    } catch {
      if (!res.headersSent) res.status(404).end();
    }
  }

  // Фото фона конструктора (2026-10-20). Ключ ставит только эта загрузка — PATCH с builderConfig
  // его не меняет (см. update). Тот же бакет и лимит, что у аватарки.
  async uploadBuilderBackground(id: string, companyId: string, file: Express.Multer.File): Promise<Landing> {
    if (!file) throw new BadRequestException('Файл не передан');
    if (file.size > MAX_AVATAR_SIZE) throw new BadRequestException('Максимальный размер файла — 5MB');
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype || '')) throw new BadRequestException('Нужна картинка: JPG, PNG, WEBP или GIF');

    const landing = await this.findOne(id, companyId);
    if (landing.templateId !== BUILDER_TEMPLATE_ID) throw new BadRequestException('Фон загружается только для лендинга из конструктора');

    const key = `landing-builder-bg/${landing.id}/${Date.now()}-${file.originalname.replace(/[^\w.-]/g, '_')}`;
    await this.storage.uploadBuffer(key, file.buffer, file.mimetype);
    const previous = currentBuilderImageKey(landing.builderConfig);
    if (previous) await this.storage.removeObject(previous);

    return this.prisma.landing.update({
      where: { id },
      data: { builderConfig: withBuilderImageKey(landing.builderConfig, key) as Prisma.InputJsonValue },
    });
  }

  async removeBuilderBackground(id: string, companyId: string): Promise<Landing> {
    const landing = await this.findOne(id, companyId);
    const previous = currentBuilderImageKey(landing.builderConfig);
    if (!previous) return landing;
    await this.storage.removeObject(previous);
    return this.prisma.landing.update({
      where: { id },
      data: { builderConfig: withBuilderImageKey(landing.builderConfig, null) as Prisma.InputJsonValue },
    });
  }

  // Публичный, как аватарка: фото фона видит любой посетитель лендинга.
  async streamBuilderBackground(id: string, res: Response): Promise<void> {
    const landing = await this.prisma.landing.findFirst({ where: { id, deletedAt: null }, select: { builderConfig: true } });
    const key = landing ? currentBuilderImageKey(landing.builderConfig) : null;
    if (!key) {
      res.status(404).end();
      return;
    }
    try {
      const stream = await this.storage.getObjectStream(key);
      const ext = key.split('.').pop()?.toLowerCase();
      const types: Record<string, string> = { png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
      res.setHeader('Content-Type', (ext && types[ext]) || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      stream.on('error', () => {
        if (!res.headersSent) res.status(404).end();
      });
      stream.pipe(res);
    } catch {
      if (!res.headersSent) res.status(404).end();
    }
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
    // канала в Telegram, либо фавиконка сайта для WEBSITE-проектов (запрос пользователя
    // 2026-09-03) — fetchChannelAvatarBuffer уже нормализует Content-Type для обоих случаев.
    if (landing.project.channel) {
      const result = await this.channelsService.fetchChannelAvatarBuffer(landing.project.channel);
      if (result) {
        res.setHeader('Content-Type', result.contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(result.buffer);
        return;
      }
    }

    res.status(404).end();
  }
}
