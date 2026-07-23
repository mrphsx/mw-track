import * as fs from 'fs/promises';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AbTestGroup, Landing, LandingStatus, Prisma, UserRole } from '@prisma/client';
import { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { dailyBucketSql } from '../../common/timezone.util';
import { TelegramProvider } from '../channels/providers/telegram.provider';
import { ChannelsService } from '../channels/channels.service';
import { StorageService } from './storage.service';
import { CreateLandingFromTemplateDto } from './dto/create-landing-from-template.dto';
import { UploadCustomLandingDto } from './dto/upload-custom-landing.dto';
import { UpdateLandingDto } from './dto/update-landing.dto';
import { AbTestMemberDto, UpsertAbTestGroupDto } from './dto/ab-test-group.dto';

const MAX_ZIP_SIZE = 50 * 1024 * 1024;
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

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
} satisfies Prisma.LandingInclude;

export type LandingWithContext = Prisma.LandingGetPayload<{ include: typeof LANDING_WITH_CONTEXT_INCLUDE }>;

@Injectable()
export class LandingsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private telegramProvider: TelegramProvider,
    private channelsService: ChannelsService,
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
    ];
  }

  // companyId приходит из контекста авторизации (контроллер передаёт его явно),
  // не из тела запроса — в доке dto.companyId был полем DTO, что позволяло бы
  // клиенту указать ЧУЖОЙ companyId и создать лендинг не в своей компании.
  async createFromTemplate(projectId: string, companyId: string, dto: CreateLandingFromTemplateDto): Promise<Landing> {
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

    return this.prisma.landing.create({
      data: {
        projectId,
        companyId,
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
  async findAllForCompany(companyId: string, userId: string, role: UserRole): Promise<LandingWithContext[]> {
    const elevatedRoles: UserRole[] = [UserRole.OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN];
    return this.prisma.landing.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(elevatedRoles.includes(role) ? {} : { project: { projectAccess: { some: { userId } } } }),
      },
      orderBy: { createdAt: 'desc' },
      include: LANDING_WITH_CONTEXT_INCLUDE,
    });
  }

  async findOne(id: string, companyId: string): Promise<Landing> {
    const landing = await this.prisma.landing.findFirst({ where: { id, companyId, deletedAt: null } });
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
  private async computeLandingStats(landing: Landing, timezone: string) {
    const id = landing.id;
    const subscribedBucket = dailyBucketSql('subscribedAt', timezone);
    const dialogueBucket = dailyBucketSql('firstDialogueAt', timezone);

    const [total, active, unsubscribed, pageViews, leads, dialogues, dailySubscribers, dailyDialogues, domainPath] = await Promise.all([
      this.prisma.client.count({ where: { landingId: id, deletedAt: null } }),
      this.prisma.client.count({ where: { landingId: id, deletedAt: null, isSubscribed: true } }),
      this.prisma.client.count({ where: { landingId: id, deletedAt: null, isSubscribed: false } }),
      this.prisma.trackingEvent.count({ where: { projectId: landing.projectId, eventName: 'PageView', payload: { path: ['landingId'], equals: id } } }),
      this.prisma.trackingEvent.count({ where: { projectId: landing.projectId, eventName: 'Lead', payload: { path: ['landingId'], equals: id } } }),
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
      landing: { id: landing.id, name: landing.name, type: landing.type, status: landing.status },
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

    // Остальные живые участники той же группы (сам landing включён в findMany — проще
    // посчитать его ещё раз через computeLandingStats, чем городить "stats + остальные").
    const members = await this.prisma.landing.findMany({ where: { abTestGroupId: landing.abTestGroupId, deletedAt: null } });
    if (members.length < 2) return stats;
    const memberStats = await Promise.all(
      members.map(async (m) => ({ weight: m.abTestWeight ?? 0, ...(await this.computeLandingStats(m, project.timezone)) })),
    );

    return { ...stats, abTestGroup: { groupId: landing.abTestGroupId, members: memberStats } };
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
  async createCustom(projectId: string, companyId: string, dto: UploadCustomLandingDto, file: Express.Multer.File): Promise<Landing> {
    const landing = await this.prisma.landing.create({
      data: { projectId, companyId, name: dto.name, type: 'CUSTOM', status: LandingStatus.DRAFT },
    });
    return this.processZipUpload(landing, file);
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

  // Общая валидация create/update: id'ы без повторов, сумма weight === 100, все лендинги из
  // одного projectId (и текущей компании — findMany ниже уже неявно заскопирован
  // PrismaService-мидлварой), никто не состоит в ЧУЖОЙ группе (currentGroupId — своя группа
  // разрешена, актуально при редактировании).
  private async assertValidMembers(projectId: string, members: AbTestMemberDto[], currentGroupId: string | null): Promise<void> {
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
      if (landing.abTestGroupId && landing.abTestGroupId !== currentGroupId) {
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

  async createAbTestGroup(projectId: string, companyId: string, dto: UpsertAbTestGroupDto): Promise<AbTestGroup> {
    await this.assertValidMembers(projectId, dto.members, null);

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

  async updateAbTestGroup(groupId: string, dto: UpsertAbTestGroupDto): Promise<AbTestGroup> {
    const group = await this.prisma.abTestGroup.findFirst({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Группа A/B-теста не найдена');
    await this.assertValidMembers(group.projectId, dto.members, groupId);

    const newIds = dto.members.map((m) => m.landingId);
    return this.prisma.$transaction(async (tx) => {
      // Лендинги, которых больше нет в новом списке участников, — просто выходят из теста.
      await tx.landing.updateMany({
        where: { abTestGroupId: groupId, id: { notIn: newIds } },
        data: { abTestGroupId: null, abTestWeight: null },
      });
      for (const m of dto.members) {
        await tx.landing.update({ where: { id: m.landingId }, data: { abTestGroupId: groupId, abTestWeight: m.weight } });
      }
      return tx.abTestGroup.update({ where: { id: groupId }, data: { name: dto.name } });
    });
  }

  // Статистика ОДНОГО участника теста ЗА ПЕРИОД (запрос пользователя 2026-07-17: "хотелось бы
  // куда-то сохранять стату за период теста") — отдельно от computeLandingStats (та считает
  // "всё время жизни лендинга", включая активность до вступления в группу; здесь строго с
  // since, момента старта теста). Компактно — без daily-массивов/attachment, не нужны для
  // застывшего снэпшота.
  private async computeAbTestMemberSnapshot(landingId: string, projectId: string, since: Date, weight: number | null) {
    const [subscribes, pageViews, leads, dialogues] = await Promise.all([
      this.prisma.client.count({ where: { landingId, deletedAt: null, subscribedAt: { gte: since } } }),
      this.prisma.trackingEvent.count({ where: { projectId, eventName: 'PageView', payload: { path: ['landingId'], equals: landingId }, eventTime: { gte: since } } }),
      this.prisma.trackingEvent.count({ where: { projectId, eventName: 'Lead', payload: { path: ['landingId'], equals: landingId }, eventTime: { gte: since } } }),
      this.prisma.client.count({ where: { landingId, deletedAt: null, firstDialogueAt: { gte: since } } }),
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
        ...(await this.computeAbTestMemberSnapshot(l.id, group.projectId, group.createdAt, l.abTestWeight)),
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
